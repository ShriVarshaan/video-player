import io
import json
import threading
import time

import pytest

from vp_sync.protocol import Server, SyncError


class Out(io.StringIO):
    def lines(self):
        return [json.loads(l) for l in self.getvalue().splitlines() if l.strip()]

    def wait_for(self, pred, timeout=2.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for l in self.lines():
                if pred(l):
                    return l
            time.sleep(0.01)
        raise AssertionError(f"no matching line in {self.lines()}")


def make(job):
    out = Out()
    return Server(job, out), out


def test_ping():
    server, out = make(lambda p, progress, cancelled: {})
    server.handle_line('{"id":3,"method":"ping"}')
    assert out.lines() == [{"id": 3, "result": "pong"}]


def test_sync_result():
    def job(params, progress, cancelled):
        progress("audio", 0.5)
        return {"offset": 3.2, "scale": 1.0, "score": 12.0}

    server, out = make(job)
    server.handle_line('{"id":1,"method":"sync","params":{"video":"v"}}')
    out.wait_for(lambda l: "result" in l)
    assert out.lines() == [
        {"id": 1, "event": "progress", "stage": "audio", "pct": 0.5},
        {"id": 1, "result": {"offset": 3.2, "scale": 1.0, "score": 12.0}},
    ]


def blocking():
    release = threading.Event()
    seen = {}

    def job(params, progress, cancelled):
        seen["cancelled"] = cancelled
        release.wait(5)
        return {"offset": 1.0, "scale": 1.0, "score": 9.0}

    return job, release, seen


def test_busy():
    job, release, _ = blocking()
    server, out = make(job)
    server.handle_line('{"id":1,"method":"sync","params":{}}')
    server.handle_line('{"id":2,"method":"sync","params":{}}')
    line = out.wait_for(lambda l: l.get("id") == 2)
    assert line["error"]["code"] == "BUSY"
    release.set()


def test_cancel_answers_within_1s():
    job, release, seen = blocking()
    server, out = make(job)
    server.handle_line('{"id":1,"method":"sync","params":{}}')
    time.sleep(0.05)
    t0 = time.monotonic()
    server.handle_line('{"id":2,"method":"cancel","params":{"target":1}}')
    line = out.wait_for(lambda l: l.get("id") == 1 and "error" in l, timeout=1.0)
    assert time.monotonic() - t0 < 1.0
    assert line["error"]["code"] == "CANCELLED"
    assert seen["cancelled"].is_set()
    release.set()


def test_sync_after_cancel_is_accepted():
    job, release, _ = blocking()
    calls = []

    def second(params, progress, cancelled):
        calls.append(params)
        return {"offset": 2.0, "scale": 1.0, "score": 8.0}

    server, out = make(lambda p, pr, c: (second if p.get("n") == 2 else job)(p, pr, c))
    server.handle_line('{"id":1,"method":"sync","params":{"n":1}}')
    time.sleep(0.05)
    server.handle_line('{"id":2,"method":"cancel","params":{"target":1}}')
    server.handle_line('{"id":3,"method":"sync","params":{"n":2}}')
    release.set()
    line = out.wait_for(lambda l: l.get("id") == 3 and "result" in l)
    assert line["result"]["offset"] == 2.0
    time.sleep(0.1)
    ids = [l.get("id") for l in out.lines() if "result" in l]
    assert ids == [3]  # the abandoned job's result is never written


def test_sync_error():
    def job(params, progress, cancelled):
        raise SyncError("NO_MATCH", "no confident match")

    server, out = make(job)
    server.handle_line('{"id":1,"method":"sync","params":{}}')
    line = out.wait_for(lambda l: "error" in l)
    assert line == {"id": 1, "error": {"code": "NO_MATCH", "message": "no confident match"}}


def test_bad_json():
    server, out = make(lambda p, pr, c: {})
    server.handle_line("{not json")
    server.handle_line('{"id":4,"method":"ping"}')
    lines = out.lines()
    assert lines[0]["id"] is None and lines[0]["error"]["code"] == "INTERNAL"
    assert lines[1] == {"id": 4, "result": "pong"}


def test_unknown_method():
    server, out = make(lambda p, pr, c: {})
    server.handle_line('{"id":5,"method":"dance"}')
    assert out.lines()[0]["error"]["code"] == "INTERNAL"


def test_unexpected_exception(capsys):
    def job(params, progress, cancelled):
        raise ValueError("boom")

    server, out = make(job)
    server.handle_line('{"id":1,"method":"sync","params":{}}')
    line = out.wait_for(lambda l: "error" in l)
    assert line["error"]["code"] == "INTERNAL" and "boom" in line["error"]["message"]
    assert "Traceback" in capsys.readouterr().err
