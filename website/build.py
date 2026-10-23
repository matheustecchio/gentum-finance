#!/usr/bin/env python3
"""Validate and copy the dependency-free public site into website/dist."""
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'dist'

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'Duplicate HTML id'
            self.ids.add(attrs['id'])
        for name in ('href', 'src'):
            if name in attrs:
                self.links.append(attrs[name])
        assert tag != 'script', 'The public site should not load scripts'

page = Page()
page.feed((ROOT / 'index.html').read_text())
for link in page.links:
    parsed = urlsplit(link)
    if parsed.scheme:
        assert parsed.scheme == 'https' and parsed.netloc == 'github.com', link
        assert parsed.path.startswith('/matheustecchio/gentum-finance'), link
    elif parsed.path:
        assert (ROOT / parsed.path).is_file(), f'Missing local asset: {link}'
    if not parsed.path and parsed.fragment:
        assert parsed.fragment in page.ids, f'Missing anchor: {link}'
css = (ROOT / 'assets/styles.css').read_text()
for asset in re.findall(r'url\([\"\']?([^\)\"\']+)', css):
    assert (ROOT / 'assets' / asset).is_file(), f'Missing CSS asset: {asset}'
assert '@media(max-width:760px)' in css, 'Missing mobile layout'
assert 'prefers-reduced-motion' in css, 'Missing reduced motion support'
if OUTPUT.exists():
    shutil.rmtree(OUTPUT)
OUTPUT.mkdir()
shutil.copy2(ROOT / 'index.html', OUTPUT / 'index.html')
shutil.copytree(ROOT / 'assets', OUTPUT / 'assets')
print('PASS: local assets, anchor targets, external URL policy, responsive rules, and static build')
print(f'Site output: {OUTPUT}')
