"""Run from backend after backup and stopping application workers.

Dry run: python scripts/cleanup_legacy_platforms.py --plan cleanup.json
Apply:   python scripts/cleanup_legacy_platforms.py --apply cleanup.json --backup /path/to/backup
The manifest remains available if file cleanup needs to be retried.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.session import SessionLocal
from app.services.attachment_storage import delete_stored_attachment
from app.services.legacy_platform_cleanup import cleanup_plan, delete_legacy_workspaces


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", type=Path)
    mode.add_argument("--apply", type=Path)
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.plan:
            plan = cleanup_plan(db)
            with args.plan.open("x", encoding="utf-8") as output:
                json.dump(plan, output, ensure_ascii=False, indent=2)
            print(f"Plan written: {len(plan['workspace_ids'])} workspaces, {plan['messages']} messages")
            return
        if not args.backup or not args.backup.exists():
            parser.error("--apply requires an existing backup path")
        expected = json.loads(args.apply.read_text(encoding="utf-8"))
        plan = delete_legacy_workspaces(db, expected["workspace_ids"])
        if plan != expected:
            raise ValueError("Data changed since the plan was generated; review a new plan")
        db.commit()
    for path in plan["exclusive_attachment_paths"]:
        delete_stored_attachment(path)
    print(f"Removed {len(plan['workspace_ids'])} legacy workspaces")


if __name__ == "__main__":
    main()
