"""Local-only manual Chrome acceptance fixtures; no extension APIs or external requests."""
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from time import sleep
from urllib.parse import urlsplit
import json

IMAGE = Path(__file__).with_name('landscape.svg').read_bytes()
counts, mutex = Counter(), Lock()
repaired = False
PAGES = {
    '/': ('普通下载与语言切换', ['a', 'b', 'c']),
    '/retry': ('仅重试失败图片', ['a', 'b', 'retry']),
    '/resume': ('取消与缓存恢复', ['a', 'b', 'c', 'd', 'slow-a', 'slow-b']),
    '/page-b': ('页面 B 隔离', ['other']),
}

class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, mime='application/json; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/stats':
            with mutex:
                data = json.dumps(dict(counts), ensure_ascii=False).encode()
            return self.send(200, data)
        if path.startswith('/images/') and path.endswith('.svg'):
            name = path.rsplit('/', 1)[1][:-4]
            download = self.headers.get('Sec-Fetch-Dest', '') != 'image'
            with mutex:
                counts[f'{name}:download' if download else f'{name}:preview'] += 1
                failed = name == 'retry' and download and not repaired
            if failed:
                return self.send(404, b'Controlled download failure', 'text/plain')
            if name.startswith('slow-') and download:
                # Headers and continuing data avoid the production stall timeout.
                self.send_response(200)
                self.send_header('Content-Type', 'image/svg+xml')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                try:
                    self.wfile.write(IMAGE.replace(b'</svg>', b'<!--'))
                    for _ in range(18):
                        self.wfile.write(b' ')
                        self.wfile.flush()
                        sleep(2)
                    self.wfile.write(b'--></svg>')
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            return self.send(200, IMAGE, 'image/svg+xml')
        if path not in PAGES:
            return self.send(404, b'Not found', 'text/plain')
        title, images = PAGES[path]
        html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Image Extractor 验收：TITLE</title>
<style>body{font:16px system-ui;max-width:900px;margin:32px auto;padding:0 20px}img{width:160px;margin:12px}button,a{margin-right:16px}pre{white-space:pre-wrap}</style>
<h1>TITLE</h1><p>仅使用本机绘制的 SVG，无外网请求。请用最新候选扩展在本页手动提取、下载。</p>
<nav><a href="/">普通下载</a><a href="/retry">失败重试</a><a href="/resume">取消与恢复</a><a href="/page-b" target="_blank">页面 B</a></nav>
<p>失败重试页中，retry 图片预览正常，下载返回 404；等任务部分完成后，点击“修复失败图片”，再在扩展中仅重试失败图片。a、b 的下载计数应不再增加。</p>
<p>恢复页有四张快图和两张慢图，慢图传输约 36 秒。快图完成后取消，继续任务应复用已完成缓存。先用“清空计数”开始每轮。</p>
<button onclick="act('reset')">清空计数</button><button onclick="act('repair')">修复失败图片</button><button onclick="stats()">查看请求计数</button><pre id="report"></pre>
<section>IMAGES</section><script>async function stats(){document.getElementById('report').textContent=JSON.stringify(await (await fetch('/stats')).json(),null,2)}async function act(action){await fetch('/'+action,{method:'POST'});await stats()}</script></html>'''
        html = html.replace('TITLE', title).replace('IMAGES', ''.join(f'<img src="/images/{name}.svg" alt="{name}">' for name in images))
        self.send(200, html.encode(), 'text/html; charset=utf-8')

    def do_POST(self):
        global repaired
        with mutex:
            if self.path == '/repair':
                repaired = True
            elif self.path == '/reset':
                counts.clear()
                repaired = False
            else:
                return self.send(404, b'Unknown action', 'text/plain')
        self.send(200, b'{}')

if __name__ == '__main__':
    print('Manual Chrome fixtures: http://127.0.0.1:8197', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8197), Handler).serve_forever()
