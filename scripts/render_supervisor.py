import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s render-supervisor: %(message)s",
)
log = logging.getLogger("render-supervisor")
stopping = False


@dataclass
class Task:
    name: str
    command: list[str]
    periodic: bool = False
    process: subprocess.Popen | None = None
    run_count: int = 0
    failures: int = 0
    next_start: float = field(default_factory=time.monotonic)
    started_at: float | None = None

    def command_for_run(self):
        if self.name != "rollup":
            return self.command
        days_key = "ROLLUP_INITIAL_DAYS" if self.run_count == 0 else "ROLLUP_OVERLAP_DAYS"
        days = os.environ.get(days_key, "30" if self.run_count == 0 else "8")
        return [*self.command, "--days", days]


def request_shutdown(signum, _frame):
    global stopping
    stopping = True
    log.info("recebido sinal %s; encerrando processos filhos", signum)


def launch(task):
    command = task.command_for_run()
    task.process = subprocess.Popen(command, env=os.environ.copy())
    task.started_at = time.monotonic()
    log.info("iniciado %s", task.name)


def monitor(task):
    if task.process is None:
        if time.monotonic() >= task.next_start:
            launch(task)
        return

    return_code = task.process.poll()
    if return_code is None:
        if task.started_at is not None and time.monotonic() - task.started_at >= 60:
            task.failures = 0
        return

    task.process = None
    now = time.monotonic()
    if task.periodic and return_code == 0:
        log.info("tarefa %s concluída", task.name)
        task.run_count += 1
        task.failures = 0
        delay = max(60, int(os.environ.get("ROLLUP_INTERVAL_SECONDS", "86400")))
    else:
        log.error("processo %s terminou com código %s", task.name, return_code)
        task.failures += 1
        delay = min(60, 2 ** min(task.failures, 6))
    task.next_start = now + delay
    log.info("nova tentativa de %s em %ss", task.name, delay)


def stop_children(tasks):
    children = [task.process for task in tasks if task.process is not None]
    for child in children:
        child.terminate()

    deadline = time.monotonic() + 25
    for child in children:
        remaining = max(0, deadline - time.monotonic())
        try:
            child.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=2)


def main():
    port = os.environ.get("PORT", "10000")
    tasks = [
        Task(
            "api",
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                port,
            ],
        ),
        Task(
            "simulator",
            [
                sys.executable,
                "-m",
                "workers.simulator",
                "--live",
                "--interval",
                os.environ.get("SIM_INTERVAL_SECONDS", "60"),
            ],
        ),
        Task("alerts", [sys.executable, "-m", "workers.alerts"]),
        Task("rollup", [sys.executable, "-m", "workers.rollup"], periodic=True),
    ]

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    for task in tasks:
        launch(task)

    try:
        while not stopping:
            for task in tasks:
                monitor(task)
            time.sleep(1)
    finally:
        stop_children(tasks)
        log.info("processos filhos encerrados")


if __name__ == "__main__":
    main()
