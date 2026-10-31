import sys

from vp_sync.protocol import serve
from vp_sync.sync import clean_stale, run


def main() -> None:
    # Paths and messages may hold any character: always UTF-8 on the pipes.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    clean_stale()
    serve(run, sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
