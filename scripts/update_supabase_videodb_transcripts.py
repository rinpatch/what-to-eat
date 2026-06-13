#!/usr/bin/env python3
import argparse
import json
import os
import signal
import sys
import urllib.parse
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def load_env_file(path):
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        os.environ.setdefault(key, value)


def load_env():
    load_env_file(REPO_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env.local")


def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing {name}. Add it to .env.local first.")
    return value


def supabase_request(method, table, query=None, body=None):
    base_url = required_env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
    service_key = required_env("SUPABASE_SERVICE_ROLE_KEY")
    url = f"{base_url}/rest/v1/{table}"
    if query:
        url += "?" + urllib.parse.urlencode(query)

    data = None
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=minimal"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {table} failed: {error.code} {detail[:500]}") from error


def fetch_rows(limit, include_processed, overwrite):
    query = {
        "select": "reel_id,url,video_url,caption,transcript,processing_error,processed,posted_at",
        "video_url": "not.is.null",
        "order": "posted_at.desc",
        "limit": str(limit),
    }
    if not include_processed:
        query["processed"] = "eq.false"
    if not overwrite:
        query["transcript"] = "is.null"
    return supabase_request("GET", "raw_reels", query=query) or []


def patch_raw_reel(reel_id, patch):
    return supabase_request("PATCH", "raw_reels", query={"reel_id": f"eq.{reel_id}"}, body=patch)


class Timeout:
    def __init__(self, seconds):
        self.seconds = seconds

    def __enter__(self):
        if self.seconds <= 0:
            return

        def handler(_signum, _frame):
            raise TimeoutError(f"operation timed out after {self.seconds}s")

        signal.signal(signal.SIGALRM, handler)
        signal.alarm(self.seconds)

    def __exit__(self, *_args):
        if self.seconds > 0:
            signal.alarm(0)


def get_videodb_collection(collection_id):
    try:
        import videodb
    except ImportError as error:
        raise RuntimeError(
            "Missing Python VideoDB SDK. Run: python3 -m pip install -t /private/tmp/videodb-python-sdk videodb"
        ) from error

    api_key = required_env("VIDEODB_API_KEY")
    connection = videodb.connect(api_key=api_key)
    return connection.get_collection(collection_id)


def transcript_for_row(collection, row, timeout_seconds, overwrite):
    name = f"{row['reel_id']} raw_reels transcript"
    with Timeout(timeout_seconds):
        video = collection.upload(url=row["video_url"], name=name)
        video.index_spoken_words(force=overwrite)
        transcript = video.get_transcript_text()
    return {
        "video_id": getattr(video, "id", None),
        "transcript": " ".join(str(transcript or "").split()),
    }


def main():
    parser = argparse.ArgumentParser(description="Write VideoDB transcripts back to Supabase raw_reels.")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--write", action="store_true", help="Actually PATCH Supabase. Default is dry-run.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing raw_reels.transcript values.")
    parser.add_argument("--include-processed", action="store_true")
    parser.add_argument("--mark-processed", action="store_true", help="Set raw_reels.processed=true when transcript succeeds.")
    parser.add_argument("--collection-id", default=os.environ.get("VIDEODB_COLLECTION_ID", "default"))
    parser.add_argument("--operation-timeout-seconds", type=int, default=240)
    args = parser.parse_args()

    load_env()
    rows = fetch_rows(args.limit, args.include_processed, args.overwrite)
    summary = {
        "dryRun": not args.write,
        "checked": len(rows),
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "rows": [],
    }

    if not rows:
        print(json.dumps(summary, indent=2))
        return 0

    collection = get_videodb_collection(args.collection_id)
    for row in rows:
        reel_id = row["reel_id"]
        try:
            result = transcript_for_row(collection, row, args.operation_timeout_seconds, args.overwrite)
            transcript = result["transcript"]
            if not transcript:
                raise RuntimeError("VideoDB returned an empty transcript")

            patch = {
                "transcript": transcript,
                "processing_error": None,
            }
            if args.mark_processed:
                patch["processed"] = True

            if args.write:
                patch_raw_reel(reel_id, patch)
                summary["updated"] += 1
                action = "updated"
            else:
                action = "would_update"

            summary["rows"].append({
                "reel_id": reel_id,
                "action": action,
                "video_id": result["video_id"],
                "transcript_chars": len(transcript),
                "columns": list(patch.keys()),
            })
        except Exception as error:
            message = f"VideoDB transcript failed: {error}"
            if args.write:
                patch_raw_reel(reel_id, {"processing_error": message[:2000]})
            summary["failed"] += 1
            summary["rows"].append({
                "reel_id": reel_id,
                "action": "failed",
                "reason": message,
            })

    print(json.dumps(summary, indent=2))
    return 1 if summary["failed"] and not summary["updated"] else 0


if __name__ == "__main__":
    sys.exit(main())
