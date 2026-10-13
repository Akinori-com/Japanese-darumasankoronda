#!/usr/bin/env python3
"""
まねっこあそび アプリ - ローカル連携サーバー
知的障害特別支援学校小学部向け

【特徴】
・Python標準ライブラリのみで動作（外部パッケージのインストール不要）
・PCのローカルIPアドレスを自動検出
・iPadから接続するためのQRコードを自動生成してコンソール＆Web上に表示
・iPad同士や電子黒板間で写真や名前をリアルタイム同期（シンプルなREST/Long Polling API）
"""

import http.server
import socketserver
import socket
import json
import urllib.parse
import os
import sys

# WindowsコンソールでのUnicodeEncodeError対策
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# 共有状態（メモリ上で保持）
shared_state = {
    "round": 1,
    "current_step": "shooting", # shooting -> naming -> presenting
    "team_roles": {
        "team_a": "shooter",   # shooter (さつえい) or namer (なまえつけ)
        "team_b": "namer"
    },
    "questions": [
        {"id": 1, "image": None, "name": ""},
        {"id": 2, "image": None, "name": ""},
        {"id": 3, "image": None, "name": ""}
    ],
    "presenting_index": 0,      # 0, 1, 2 (1もんめ〜3もんめ)
    "show_answer": False,       # なまえをオープンしたか
    "is_mimicking": False,      # まねっこ中かどうか
    "version": 1,
    "updated_at": 0
}

def get_local_ip():
    """PCのローカルWi-Fi IPアドレスを取得"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 外部へルーティング可能なソケットを開いて自身のIPを特定
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class ManekkoHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # CORSヘッダーを追加
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # 状態取得API
        if parsed.path == '/api/state':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(shared_state).encode('utf-8'))
            return

        # サーバー情報API（IPとURL取得）
        if parsed.path == '/api/info':
            ip = get_local_ip()
            info = {
                "ip": ip,
                "port": PORT,
                "url": f"http://{ip}:{PORT}"
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(info).encode('utf-8'))
            return

        return super().do_GET()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ('/api/state', '/api/info'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            return
        return super().do_HEAD()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        if parsed.path == '/api/state':
            try:
                data = json.loads(body.decode('utf-8'))
                # 状態を更新
                for key in data:
                    if key in shared_state:
                        shared_state[key] = data[key]
                shared_state["version"] = shared_state.get("version", 0) + 1
                import time
                shared_state["updated_at"] = int(time.time() * 1000)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "state": shared_state}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
            return

        if parsed.path == '/api/reset':
            # リセット
            shared_state["round"] = 1
            shared_state["current_step"] = "shooting"
            shared_state["team_roles"] = {"team_a": "shooter", "team_b": "namer"}
            shared_state["questions"] = [
                {"id": 1, "image": None, "name": ""},
                {"id": 2, "image": None, "name": ""},
                {"id": 3, "image": None, "name": ""}
            ]
            shared_state["presenting_index"] = 0
            shared_state["show_answer"] = False
            shared_state["is_mimicking"] = False
            import time
            shared_state["updated_at"] = int(time.time() * 1000)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "state": shared_state}).encode('utf-8'))
            return

        if parsed.path == '/api/swap':
            # 攻守交代
            shared_state["round"] += 1
            shared_state["current_step"] = "shooting"
            # 役割反転
            cur_a = shared_state["team_roles"]["team_a"]
            shared_state["team_roles"]["team_a"] = "namer" if cur_a == "shooter" else "shooter"
            shared_state["team_roles"]["team_b"] = "shooter" if cur_a == "shooter" else "namer"
            shared_state["questions"] = [
                {"id": 1, "image": None, "name": ""},
                {"id": 2, "image": None, "name": ""},
                {"id": 3, "image": None, "name": ""}
            ]
            shared_state["presenting_index"] = 0
            shared_state["show_answer"] = False
            shared_state["is_mimicking"] = False
            import time
            shared_state["updated_at"] = int(time.time() * 1000)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "state": shared_state}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run():
    ip = get_local_ip()
    url = f"http://{ip}:{PORT}"
    
    print("=" * 60)
    print("[*] まねっこあそび サーバーが起動しました！ [*]")
    print("=" * 60)
    print(f"【PC・電子黒板でのアクセス】: http://localhost:{PORT}")
    print(f"【児童のiPadでのアクセス】  : {url}")
    print("=" * 60)
    print("※ iPadと同じWi-Fiに接続していることをご確認ください。")
    print("※ 画面上にもiPad接続用のQRコードが表示されます。")
    print("終了するには Ctrl + C を押してください。\n")

    # ポートの再利用を許可
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ManekkoHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました。")

if __name__ == '__main__':
    run()
