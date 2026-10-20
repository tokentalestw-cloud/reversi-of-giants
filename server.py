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
import time

WAIT_TTL = 600.0   # 等待朋友加入時，即使房主切換 App 斷線，房間仍保留 10 分鐘
GAME_TTL = 180.0   # 對局進行中若暫時切換畫面斷線，保留 3 分鐘等待自動重連

# code -> {
#   "tokens": {1: cid1, 2: cid2},
#   "players": {1: ws_or_None, 2: ws_or_None},
#   "started": False,
#   "seed": int,
#   "actions": list,
#   "rematch": set(),
#   "timer": asyncio.Task | None,
# }
rooms = {}


def new_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(random.choice(alphabet) for _ in range(4))
        if code not in rooms:
            return code


def cancel_room_timer(room):
    t = room.get("timer")
    if t and not t.done():
        t.cancel()
    room["timer"] = None


def schedule_room_cleanup(code, delay, notify_left=False):
    room = rooms.get(code)
    if not room:
        return
    cancel_room_timer(room)

    async def _job():
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        r = rooms.get(code)
        if not r:
            return
        active = {c: p for c, p in r["players"].items() if p is not None and not p.closed}
        if notify_left and active:
            for p in active.values():
                await p.send({"t": "opponent_left"})
        if not active or notify_left:
            rooms.pop(code, None)
            print(f"[房間] 逾時關閉 {code}")

    room["timer"] = asyncio.create_task(_job())


async def start_game(room, code):
    room["started"] = True
    room["seed"] = random.randint(1, 2**31 - 1)
    room["actions"] = []
    cancel_room_timer(room)
    for color, ws in list(room["players"].items()):
        if ws and not ws.closed:
            await ws.send({
                "t": "start",
                "seed": room["seed"],
                "color": color,
                "code": code,
                "actions": room["actions"],
            })


def other(room, color):
    peer_color = 2 if color == 1 else 1
    p = room["players"].get(peer_color)
    return p if (p and not p.closed) else None


async def leave_room_explicitly(ws: WebSocket):
    code = ws.room
    ws.room = None
    if not code:
        return
    room = rooms.get(code)
    if not room:
        return
    cancel_room_timer(room)
    peer = other(room, ws.color)
    if peer:
        await peer.send({"t": "opponent_left"})
    rooms.pop(code, None)
    print(f"[房間] 玩家主動離開，關閉 {code}")


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
                cid = str(msg.get("cid") or "") or new_code()
                # 若該玩家剛建立過且尚未開局的房間還在，直接複用或清理舊房
                code = new_code()
                rooms[code] = {
                    "tokens": {1: cid},
                    "players": {1: ws},
                    "started": False,
                    "seed": random.randint(1, 2**31 - 1),
                    "actions": [],
                    "rematch": set(),
                    "timer": None,
                }
                ws.room, ws.color = code, 1
                await ws.send({"t": "created", "code": code})
                print(f"[房間] 建立 {code} (cid={cid[:8]})")

            elif t in ("join", "rejoin"):
                code = str(msg.get("code", "")).upper().strip()
                cid = str(msg.get("cid") or "")
                room = rooms.get(code)
                if not room:
                    await ws.send({"t": "error", "msg": "找不到這個房間代碼（可能已逾時關閉）"})
                    continue

                # 1. 檢查是否為原房主或原玩家重連（例如切換去 LINE 貼連結後切回瀏覽器）
                my_color = None
                for c, tok in room["tokens"].items():
                    if cid and tok == cid:
                        my_color = c
                        break

                if my_color is not None:
                    old_ws = room["players"].get(my_color)
                    if old_ws and old_ws is not ws and not old_ws.closed:
                        old_ws.room = None
                    room["players"][my_color] = ws
                    ws.room, ws.color = code, my_color
                    cancel_room_timer(room)
                    if not room["started"]:
                        await ws.send({"t": "created", "code": code})
                        print(f"[房間] {code} 房主返回等待畫面")
                    else:
                        await ws.send({
                            "t": "sync",
                            "seed": room["seed"],
                            "color": my_color,
                            "code": code,
                            "actions": room["actions"],
                        })
                        peer = other(room, my_color)
                        if peer:
                            await peer.send({"t": "opponent_status", "online": True})
                        print(f"[房間] {code} 玩家 {my_color} 重連成功")
                    continue

                # 2. 新玩家加入房間
                if len(room["tokens"]) >= 2:
                    await ws.send({"t": "error", "msg": "房間已滿"})
                    continue

                color = 2 if 1 in room["tokens"] else 1
                room["tokens"][color] = cid or new_code()
                room["players"][color] = ws
                ws.room, ws.color = code, color
                print(f"[房間] {code} 對手加入，開始對局")
                await start_game(room, code)
                # 若房主此時仍在 LINE 等外部 App 尚未切回，啟動對局保留計時器等待房主切回
                if not other(room, color):
                    schedule_room_cleanup(code, WAIT_TTL, notify_left=True)

            elif t == "action":
                room = rooms.get(ws.room)
                if room and room["started"]:
                    ply = msg.get("ply")
                    if ply == len(room["actions"]):
                        room["actions"].append(msg.get("action"))
                    peer = other(room, ws.color)
                    if peer:
                        await peer.send(msg)

            elif t in ("chat", "emote"):
                room = rooms.get(ws.room)
                if room:
                    peer = other(room, ws.color)
                    if peer:
                        await peer.send(msg)

            elif t == "rematch":
                room = rooms.get(ws.room)
                if not room or len(room["tokens"]) < 2:
                    continue
                room["rematch"].add(ws.color)
                peer = other(room, ws.color)
                if len(room["rematch"]) >= 2:
                    room["rematch"].clear()
                    # 交換先後手
                    p = room["players"]
                    tok = room["tokens"]
                    p[1], p[2] = p.get(2), p.get(1)
                    tok[1], tok[2] = tok.get(2), tok.get(1)
                    for c, s in p.items():
                        if s:
                            s.color = c
                    await start_game(room, ws.room)
                elif peer:
                    await peer.send({"t": "rematch_request"})

            elif t == "leave":
                await leave_room_explicitly(ws)

            elif t == "ping":
                await ws.send({"t": "pong"})
    except (WSClosed, asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        ws.closed = True
        code = ws.room
        room = rooms.get(code) if code else None
        if room:
            if room["players"].get(ws.color) is ws:
                room["players"][ws.color] = None
            if not room["started"]:
                # 房主在等待畫面切換去 LINE 分享代碼：保留房間 10 分鐘！
                print(f"[房間] {code} 房主暫時離開畫面，保留房間 {int(WAIT_TTL)} 秒")
                schedule_room_cleanup(code, WAIT_TTL, notify_left=False)
            else:
                peer = other(room, ws.color)
                if peer:
                    await peer.send({"t": "opponent_status", "online": False})
                print(f"[房間] {code} 玩家 {ws.color} 暫時斷線，保留對局 {int(GAME_TTL)} 秒")
                schedule_room_cleanup(code, GAME_TTL, notify_left=True)


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
