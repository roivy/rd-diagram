# -*- coding: utf-8 -*-
"""Build the encrypted single-file share deck (.rd/demo/index_share.html).

Takes the built deck (index.html) plus its ten demo pages and produces ONE
self-contained file for sharing:

  - every page is gzip-compressed, XOR-encrypted with a mulberry32 keystream
    and embedded as base64 (no plaintext page content in the file);
  - a small loader decrypts at runtime (DecompressionStream, Edge/Chrome 80+)
    and loads each page into its iframe via srcdoc — postMessage bridge,
    trace effects and grouped indexes keep working unchanged;
  - the deck shell's scripts/styles are stripped of comments and indentation;
  - AI/decompiler prohibition: robots/noai/noimageai meta tags, a bilingual
    prohibition banner comment, and a visible cover notice.

Client-side encryption raises the bar; it cannot stop a determined attacker.
"""
import base64
import gzip
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'demo')
SEED = 20261014

PAGES = [
    '00-roster.html', '01-fa-fishbone.html', '02-dfmea.html', '03-mainboard.html',
    '04-8d-flow.html', '05-mindmap.html', '06a-workflow.html', '06b-sequence.html',
    '06c-dataflow.html', '06d-lifecycle.html',
]

NOTICE = '''<!--
  Roivy Diagram - 内部分享版 (Confidential)
  本文件为 Roivy 授权内部演示材料, 仅供指定接收者本人查看。
  禁止: 反向工程 / 反编译 / 解密 / 提取页面内容或数据;
  禁止将本文件全部或部分用于 AI 或机器学习训练 / 数据挖掘 / 知识库沉淀;
  禁止二次分发 / 公开传播 / 上传任何在线服务。
  This file is Roivy confidential material. Reverse engineering, decompilation,
  decryption, content extraction, AI/ML training, data mining, redistribution
  and public posting are strictly prohibited.
-->'''

LOADER = r"""<script>
(function(){function ub(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function ks(a,n){var o=new Uint8Array(n);a=a>>>0;for(var i=0;i<n;i++){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);o[i]=(t^(t>>>14))>>>24}return o}
function dx(b64,sd){var c=ub(b64),k=ks(sd,c.length),p=new Uint8Array(c.length);for(var i=0;i<c.length;i++)p[i]=c[i]^k[i];return new Response(new Blob([p]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}
function fail(){document.body.innerHTML='<div style="font:14px/1.8 Segoe UI,Microsoft YaHei;color:#eee;background:#0a0a10;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px">此分享包需要 Edge / Chrome 80+ 打开(需要 DecompressionStream 支持)。<br>Please open this file in Microsoft Edge or Google Chrome 80+.</div>'}
var el=document.getElementById('rd-data');if(!el)return;
if(!window.DecompressionStream||!window.Blob||!Blob.prototype.stream){fail();return}
try{var d=JSON.parse(el.textContent);
Promise.all(d.p.map(function(x){return dx(x,d.s)})).then(function(pg){var fs=document.querySelectorAll('iframe[data-rd-p]');
for(var i=0;i<fs.length;i++){fs[i].setAttribute('srcdoc',pg[+fs[i].getAttribute('data-rd-p')])}}).catch(fail)}catch(e){fail()}})();
</script>"""


def keystream(seed, n):
    """mulberry32 bytes — must stay byte-identical to the JS loader's ks()."""
    out = bytearray(n)
    a = seed & 0xFFFFFFFF
    for i in range(n):
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        out[i] = (t ^ (t >> 14)) >> 24
    return bytes(out)


def encrypt(text):
    raw = text.encode('utf-8')
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', mtime=0) as gz:
        gz.write(raw)
    comp = buf.getvalue()
    key = keystream(SEED, len(comp))
    return base64.b64encode(bytes(c ^ k for c, k in zip(comp, key))).decode('ascii')


def decrypt(b64):
    comp = base64.b64decode(b64)
    key = keystream(SEED, len(comp))
    raw = gzip.decompress(bytes(c ^ k for c, k in zip(comp, key)))
    return raw.decode('utf-8')


def strip_shell(html):
    """Remove comments and indentation from the shell's scripts and styles.

    Keeps the prohibition banner (it is the first HTML comment) and any other
    HTML comments; only JS line/block comments and leading whitespace go.
    """
    # JS/CSS block comments.
    html = re.sub(r'/\*[\s\S]*?\*/', '', html)
    # Line comments that start a line (never matches protocol-relative URLs).
    html = re.sub(r'^[ \t]*//[^\n]*\n', '', html, flags=re.M)
    # Leading indentation.
    html = re.sub(r'^[ \t]+', '', html, flags=re.M)
    # Blank-line runs.
    html = re.sub(r'\n{2,}', '\n', html)
    return html


def build():
    deck = io.open(os.path.join(DEMO, 'index.html'), encoding='utf-8').read()

    payloads = []
    for i, page in enumerate(PAGES):
        html = io.open(os.path.join(DEMO, page), encoding='utf-8').read()
        assert 'data-rd="deck-bridge"' in html, 'bridge missing in ' + page
        payloads.append(encrypt(html))
        # Self-test the round trip, then swap the src for the encrypted slot id.
        assert decrypt(payloads[-1]) == html, 'round trip failed for ' + page
        needle = 'src="' + page + '"'
        assert deck.count(needle) == 1, 'iframe src not unique: ' + page
        deck = deck.replace(needle, 'data-rd-p="' + str(i) + '"')

    payload_tag = '<script id="rd-data" type="application/json">' \
        + json.dumps({'s': SEED, 'p': payloads}, separators=(',', ':')) \
        + '</script>\n'

    deck = deck.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + NOTICE)
    deck = deck.replace('<meta name="viewport"',
        '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex,notranslate">\n'
        '<meta name="noai" content="noai">\n<meta name="noimageai" content="noimageai">\n'
        '<meta name="viewport"')
    deck = deck.replace('<title>Roivy Diagram</title>', '<title>Roivy Diagram（内部分享版）</title>')

    # Visible authorization line on the cover, next to the paging hint.
    notice_entities = (' &#183; Roivy &#20869;&#37096;&#36164;&#26009;&#65292;&#20165;&#38480;&#25480;&#26435;&#25509;&#25910;&#32773;'
                       '&#65292;&#31105;&#27490;&#21453;&#21521;&#24037;&#31243;&#19982; AI &#35757;&#32451;/&#25552;&#21462;')
    deck, hint_count = re.subn(r'(class="cover-hint">)([^<]*)(</div>)',
                               lambda m: m.group(1) + m.group(2) + notice_entities + m.group(3),
                               deck, count=1)
    assert hint_count == 1, 'cover hint line not found'

    deck = strip_shell(deck)
    # Strip shell AFTER assembling text pieces; append loader last.
    deck = deck.replace('</body>', payload_tag + LOADER + '\n</body>')

    out = os.path.join(DEMO, 'index_share.html')
    io.open(out, 'w', encoding='utf-8', newline='\n').write(deck)
    plain = sum(os.path.getsize(os.path.join(DEMO, p)) for p in PAGES)
    print('share:', out)
    print('  payload pages: %d | plaintext total: %.1f MB | bundle: %.2f MB' % (
        len(payloads), plain / 1048576.0, os.path.getsize(out) / 1048576.0))


if __name__ == '__main__':
    build()
