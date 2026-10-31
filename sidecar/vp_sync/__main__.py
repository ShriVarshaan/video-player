import sys

from vp_sync.protocol import serve
from vp_sync.sync import run


def main() -> None:
    # Paths and messages may hold any character: always UTF-8 on the pipes.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    serve(run, sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
