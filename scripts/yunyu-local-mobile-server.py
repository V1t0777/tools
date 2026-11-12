#!/usr/bin/env python3
"""Manually started LAN-only Yunyu offline/mobile layout review HTTP server.

Never bind to 0.0.0.0. Only one explicitly allowed iPhone IPv4 may connect.
No SQL, sessions, remote deployment, upload, or user-data export is performed.
HTTP on a home LAN is NOT a production-safe cloud-auth/secure-context test.
"""
from __future__ import annotations
import argparse
import ipaddress
import mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

LAN_RANGES = tuple(ipaddress.ip_network(x) for x in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
))


def private_ipv4(raw: str) -> str:
    try:
        value = ipaddress.IPv4Address(raw.strip())
    except (ValueError, AttributeError):
        raise argparse.ArgumentTypeError("请输入有效的IPv4地址") from None
    if not any(value in network for network in LAN_RANGES):
        raise argparse.ArgumentTypeError("只允许家庭局域网RFC1918 IPv4地址")
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="云屿 · 私有局域网iPhone离线验收")
    parser.add_argument("--bind-ip", type=private_ipv4, required=True,
                        help="电脑的局域网IP，不允许公网或0.0.0.0")
    parser.add_argument("--phone-ip", type=private_ipv4, required=True,
                        help="当前iPhone Wi-Fi的局域网IP；只允许此设备")
    parser.add_argument("--port", type=int, default=8766)
    options = parser.parse_args()
    if not 1024 <= options.port <= 65535:
        parser.error("端口必须在1024–65535之间")
    root = Path(__file__).resolve().parent
    mimetypes.add_type("text/javascript", ".mjs")

    class AllowOnePhone(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def allowed(self) -> bool:
            return self.client_address[0] == options.phone_ip

        def deny_if_needed(self) -> bool:
            if not self.allowed():
                self.send_error(403, "NOT_AN_APPROVED_LOCAL_DEVICE")
                return True
            route = urlsplit(self.path).path
            # A LAN HTTP listener cannot safely carry account passwords or
            # Supabase auth tokens. Private phone QA is deliberately offline.
            if (route.startswith("/merge/cloud") or
                    route.startswith("/shared/toolbox-auth") or
                    route.startswith("/shared/vendor/supabase")):
                self.send_error(403, "CLOUD_AUTH_REQUIRES_PRIVATE_HTTPS")
                return True
            return False

        def do_GET(self) -> None:
            if not self.deny_if_needed():
                super().do_GET()

        def do_HEAD(self) -> None:
            if not self.deny_if_needed():
                super().do_HEAD()

        def list_directory(self, path):
            self.send_error(403, "DIRECTORY_LISTING_DISABLED")
            return None

        def end_headers(self) -> None:
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

    print(f"只允许iPhone {options.phone_ip}：http://{options.bind_ip}:{options.port}/")
    print("当前服务仅可在该局域网内访问；手机断开Wi-Fi时不可用。按Ctrl+C结束。")
    print("注意：HTTP私有局域网只适合离线UI/游戏测试，不能用于云账号或安全上下文验收。")
    try:
        with HTTPServer((options.bind_ip, options.port), AllowOnePhone) as httpd:
            httpd.serve_forever(poll_interval=0.2)
    except OSError as error:
        raise SystemExit(f"绑定地址失败：{error}") from error
    except KeyboardInterrupt:
        print("\n私有测试服务器已停止")


if __name__ == "__main__":
    main()
