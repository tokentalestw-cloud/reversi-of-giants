# -*- coding: utf-8 -*-
"""
科學巨人黑白棋 - 連線伺服器（僅使用 Python 標準函式庫，免安裝套件）

功能：
  1. 提供 public/ 目錄下的靜態網頁
  2. 在 /ws 提供 WebSocket，負責房間配對與轉發雙方的落子動作

啟動：python server.py [port]
"""
import asyncio
import base64
import hashlib
import json
import os
import random
import socket
import string
import struct
import sys
from urllib.parse import unquote, urlparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8765))  # Render 等雲端平台會以環境變數 PORT 指定埠號
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Windows 的 mimetypes 有時會把 .js 判成 text/plain，導致 ES module 無法載入，因此手動指定
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}


# ---------------------------------------------------------------- WebSocket
class WSClosed(Exception):
    pass


class WebSocket:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.room = None
        self.color = None
        self.closed = False
        self.lock = asyncio.Lock()

    async def recv(self):
        """回傳一則文字訊息；連線關閉時丟出 WSClosed。"""
        buf = b""
        while True:
            hdr = await self.reader.readexactly(2)
            b1, b2 = hdr[0], hdr[1]
            fin = b1 & 0x80
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack("!H", await self.reader.readexactly(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", await self.reader.readexactly(8))[0]
            if length > 1 << 20:
                raise WSClosed()
            mask = await self.reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
            data = bytearray(await self.reader.readexactly(length))
            for i in range(length):
                data[i] ^= mask[i % 4]
            if opcode == 0x8:  # close
                raise WSClosed()
            if opcode == 0x9:  # ping -> pong
                await self._send_frame(0xA, bytes(data))
                continue
            if opcode == 0xA:  # pong
                continue
            buf += bytes(data)
            if fin:
                return buf.decode("utf-8", errors="replace")

    async def _send_frame(self, opcode, payload: bytes):
        if self.closed:
            return
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        async with self.lock:
            try:
                self.writer.write(header + payload)
                await self.writer.drain()
            except Exception:
                self.closed = True

    async def send(self, obj):
        await self._send_frame(0x1, json.dumps(obj, ensure_ascii=False).encode("utf-8"))


# ---------------------------------------------------------------- 房間管理
rooms = {}  # code -> {"players": {1: ws, 2: ws}, "rematch": set()}


def new_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(random.choice(alphabet) for _ in range(4))
        if code not in rooms:
            return code


async def start_game(room):
    seed = random.randint(1, 2**31 - 1)
    for color, ws in room["players"].items():
        await ws.send({"t": "start", "seed": seed, "color": color, "code": ws.room})


def other(room, ws):
    for c, p in room["players"].items():
        if p is not ws:
            return p
    return None


async def ws_session(ws: WebSocket):
    try:
        while True:
            raw = await ws.recv()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            t = msg.get("t")

            if t == "create":
                code = new_code()
                rooms[code] = {"players": {1: ws}, "rematch": set()}
                ws.room, ws.color = code, 1
                await ws.send({"t": "created", "code": code})
                print(f"[房間] 建立 {code}")

            elif t == "join":
                code = str(msg.get("code", "")).upper().strip()
                room = rooms.get(code)
                if not room:
                    await ws.send({"t": "error", "msg": "找不到這個房間代碼"})
                    continue
                if len(room["players"]) >= 2:
                    await ws.send({"t": "error", "msg": "房間已滿"})
                    continue
                color = 2 if 1 in room["players"] else 1
                room["players"][color] = ws
                ws.room, ws.color = code, color
                print(f"[房間] {code} 對手加入，開始對局")
                await start_game(room)

            elif t in ("action", "chat", "emote"):
                room = rooms.get(ws.room)
                if room:
                    peer = other(room, ws)
                    if peer:
                        await peer.send(msg)

            elif t == "rematch":
                room = rooms.get(ws.room)
                if not room or len(room["players"]) < 2:
                    continue
                room["rematch"].add(ws.color)
                peer = other(room, ws)
                if len(room["rematch"]) >= 2:
                    room["rematch"].clear()
                    # 交換先後手
                    p = room["players"]
                    p[1], p[2] = p[2], p[1]
                    for c, s in p.items():
                        s.color = c
                    await start_game(room)
                elif peer:
                    await peer.send({"t": "rematch_request"})

            elif t == "ping":
                await ws.send({"t": "pong"})
    except (WSClosed, asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        ws.closed = True
        room = rooms.get(ws.room) if ws.room else None
        if room:
            room["players"] = {c: p for c, p in room["players"].items() if p is not ws}
            for p in room["players"].values():
                await p.send({"t": "opponent_left"})
            if not room["players"]:
                rooms.pop(ws.room, None)
                print(f"[房間] 關閉 {ws.room}")


# ---------------------------------------------------------------- HTTP
async def send_http(writer, status, body=b"", ctype="text/plain; charset=utf-8"):
    head = (
        f"HTTP/1.1 {status}\r\n"
        f"Content-Type: {ctype}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: close\r\n\r\n"
    ).encode()
    writer.write(head + body)
    await writer.drain()


async def handle(reader, writer):
    try:
        raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=15)
    except Exception:
        writer.close()
        return
    lines = raw.decode("latin-1").split("\r\n")
    try:
        method, target, _ = lines[0].split(" ", 2)
    except ValueError:
        writer.close()
        return
    headers = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    path = unquote(urlparse(target).path)

    # WebSocket 升級
    if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        await writer.drain()
        sock = writer.get_extra_info("socket")
        if sock is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
        await ws_session(WebSocket(reader, writer))
        try:
            writer.close()
        except Exception:
            pass
        return

    # 靜態檔案
    if method not in ("GET", "HEAD"):
        await send_http(writer, "405 Method Not Allowed", b"405")
        writer.close()
        return
    if path.endswith("/"):
        path += "index.html"
    full = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
    if not full.startswith(ROOT) or not os.path.isfile(full):
        await send_http(writer, "404 Not Found", "找不到檔案".encode("utf-8"))
        writer.close()
        return
    ext = os.path.splitext(full)[1].lower()
    with open(full, "rb") as f:
        body = f.read()
    await send_http(writer, "200 OK", body if method == "GET" else b"", MIME.get(ext, "application/octet-stream"))
    writer.close()


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips)


async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", PORT)
    print("=" * 56)
    print("  科學巨人黑白棋 伺服器已啟動")
    print(f"  本機遊玩：  http://localhost:{PORT}")
    for ip in lan_ips():
        print(f"  區網好友：  http://{ip}:{PORT}")
    print("  (按 Ctrl+C 關閉)")
    print("=" * 56)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n伺服器已關閉")
