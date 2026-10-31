import sys

from vp_sync.protocol import SyncError, serve


def _not_built(params, progress, cancelled):
    raise SyncError("INTERNAL", "not built")


def main() -> None:
    # Paths and messages may hold any character: always UTF-8 on the pipes.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    serve(_not_built, sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
