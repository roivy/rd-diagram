# -*- coding: utf-8 -*-
"""Build deck: pure-tech CSS cover + full-viewer iframe pages with page-enter effects."""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'demo')

PAGES = [
    ('01', '00-roster.html', u'\u7ec4\u5efa\u56e2\u961f \u2014 \u7ec4\u7ec7\u67b6\u6784\u6811', u'\u5355\u51fb\u4efb\u610f\u4eba\u770b\u8be6\u60c5 \u00b7 \u7d22\u5f15\u6309\u56e2\u961f\u5206\u7ec4', 'roster'),
    ('02', '02-dfmea.html', 'DFMEA \u7cfb\u7edf\u67b6\u6784\u56fe', u'\u516d\u57df27\u5b50\u7cfb\u7edf \u00b7 \u5149\u7ebf\u6cbf\u903b\u8f91\u6d41\u5411\u6d41\u52a8', 'architecture'),
    ('03', '03-mainboard.html', u'\u4e3b\u63a7\u677f\u7535\u5b50\u539f\u7406\u6846\u56fe', 'IEC\u7b26\u53f7 \u00b7 6\u79cd\u4fe1\u53f7\u7ebf\u578b', 'electronic'),
    ('04', None, 'FA \u903b\u8f91\u56fe', '6M\u9c7c\u9aa8 + 8D\u6d41\u7a0b \u00b7 \u7d22\u5f15\u63096M/D\u9636\u5206\u7ec4', 'fishbone'),
    ('05', '05-mindmap.html', u'\u4e8c\u4ee3\u89c4\u5212\u601d\u7ef4\u5bfc\u56fe', '8\u5206\u652f82\u8282\u70b9 \u00b7 \u7d22\u5f15\u6309\u5206\u652f\u5206\u7ec4', 'mindmap'),
    ('06', '06a-workflow.html', u'\u5de5\u4f5c\u6d41', '', 'workflow'),
    ('07', '06b-sequence.html', u'\u65f6\u5e8f\u56fe', '', 'sequence'),
    ('08', '06c-dataflow.html', u'\u6570\u636e\u6d41', '', 'dataflow'),
    ('09', '06d-lifecycle.html', u'\u72b6\u6001\u673a', '', 'lifecycle'),
]

def build():
    # Inject the postMessage bridge into every demo page the deck embeds.
    # Chrome blocks a file:// parent from accessing iframe.contentDocument, so
    # page-entry effects travel by postMessage; the bridge is inert when the
    # page is opened standalone. Idempotent: skip pages already carrying it.
    bridge = io.open(os.path.join(ROOT, 'tools', '.deck-bridge.js'), encoding='utf-8').read()
    bridge_tag = '\n<script data-rd="deck-bridge">\n' + bridge + '\n</script>\n'
    page_files = ['00-roster.html', '01-fa-fishbone.html', '02-dfmea.html', '03-mainboard.html',
                  '04-8d-flow.html', '05-mindmap.html', '06a-workflow.html', '06b-sequence.html',
                  '06c-dataflow.html', '06d-lifecycle.html']
    for name in page_files:
        path = os.path.join(DEMO, name)
        html = io.open(path, encoding='utf-8').read()
        html = re.sub(r'\n?<script data-rd="deck-bridge">[\s\S]*?</script>\n?', '\n', html)
        html = html.replace('</body>', bridge_tag + '</body>')
        io.open(path, 'w', encoding='utf-8', newline='\n').write(html)

    scenes = []
    for num, src, title, desc, tag in PAGES:
        tag_h = '<span class="tag">' + tag + '</span>'
        if src is None:
            frame = ('<div class="frame" style="display:flex;flex-direction:row;">'
                     '<iframe src="01-fa-fishbone.html" style="flex:1;border:0;min-width:0;"></iframe>'
                     '<iframe src="04-8d-flow.html" style="flex:1;border:0;min-width:0;"></iframe></div>')
        else:
            frame = '<div class="frame"><iframe src="' + src + '"></iframe></div>'
        scenes.append(
            '<section class="slide"><div class="scene"><div class="no">' + num + '</div>'
            '<div><h2>' + title + '</h2><p>' + desc + '</p>'
            '<div class="tags">' + tag_h + '</div></div></div>' + frame + '</section>'
        )

    autoplay = io.open(os.path.join(ROOT, 'tools', '.autoplay.js'), encoding='utf-8').read()
    t = io.open(os.path.join(ROOT, 'tools', '.hero_template.html'), encoding='utf-8').read()
    t = t.replace('<!--SCENES-->', '\n'.join(scenes))
    t = t.replace('<!--AUTOPLAY-->', '<script>\n' + autoplay + '\n</script>')

    out = os.path.join(DEMO, 'index.html')
    io.open(out, 'w', encoding='utf-8', newline='\n').write(t)
    print('deck:', out, len(t), 'bytes | iframes:', t.count('<iframe'), '| slides:', t.count('<section class="slide"'))

if __name__ == '__main__':
    build()
