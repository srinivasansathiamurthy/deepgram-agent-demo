import time
import uuid
from pathlib import Path

from config import SESSIONS_DIR


class Session:
    """Owns one on-disk session: creates its directory and appends to chat_history.txt."""

    def __init__(self) -> None:
        self.session_id  = f"session_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        self.session_dir = SESSIONS_DIR / self.session_id
        self.chat_file   = self.session_dir / "chat_history.txt"
        self._create()

    def _create(self) -> None:
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.chat_file.write_text(
            f"# Deepgram Documentation Voice Agent — Session {self.session_id}\n"
            f"# Started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n",
            encoding="utf-8",
        )

    def append_chat(self, role: str, content: str) -> None:
        stamp = int(time.time())
        with self.chat_file.open("a", encoding="utf-8") as fh:
            fh.write(f"[{stamp}] {role.upper()}: {content}\n")
