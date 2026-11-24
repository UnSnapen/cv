"""Documents du CV de Kenza SKALLI au style du site : CV (A4, 2 pages), présentation (A4, 1 page),
carte de visite (85 × 55 mm, recto verso) et dossier de compétences (A4), imprimés par Chrome sans fenêtre.

Source unique : index.html (le contenu publié sur le site). Sorties : assets/Kenza-SKALLI-CV.pdf et
assets/documents/ (PDF, vignettes, carte de contact .vcf, archive .zip).
Usage : python scripts/documents.py
"""
from __future__ import annotations

import base64
import html
import io
import os
import pathlib
import re
import subprocess
import zipfile

import fitz  # PyMuPDF

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / 'assets' / 'documents'
BUILD = ROOT / 'scripts' / 'build'
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
SITE = 'https://cv-kenza.my-officeapps.com/'
NAME = 'Kenza SKALLI'
e = lambda s: html.escape(str(s), quote=True)


# ============================================================================ lecture du site
def text(fragment: str, keep_bold: bool = False) -> str:
    """Texte d'un fragment HTML (balises retirées), en gardant éventuellement le gras."""
    if keep_bold:
        fragment = re.sub(r'<b>(.*?)</b>', '\x01\\1\x02', fragment, flags=re.S)
    out = html.unescape(re.sub(r'<[^>]+>', '', fragment))
    out = re.sub(r'\s+', ' ', out).strip()
    if keep_bold:
        out = e(out).replace('\x01', '<b>').replace('\x02', '</b>')
    return out


def section(src: str, sid: str) -> str:
    m = re.search(rf'<section class="sec[^"]*" id="{sid}".*?</section>', src, flags=re.S)
    if not m:
        raise SystemExit(f'section #{sid} introuvable dans index.html')
    return m.group(0)


def read_site() -> dict:
    src = (ROOT / 'index.html').read_text(encoding='utf-8')
    d = {}
    prof = section(src, 'profil')
    d['statement'] = text(re.search(r'<h2[^>]*>(.*?)</h2>', prof, re.S).group(1))
    d['lede'] = text(re.search(r'<p class="lede[^"]*"[^>]*>(.*?)</p>', prof, re.S).group(1))
    d['desc'] = text(re.search(r'<p class="desc" id="desc">(.*?)</p>', src, re.S).group(1))
    d['kp'] = [(text(n), text(l)) for n, l in re.findall(r'<div class="n">(.*?)</div><div class="l">(.*?)</div>', prof, re.S)]
    wins = re.search(r'<div class="wins">(.*?)</div>\s*<div class="facts">', prof, re.S).group(1)
    d['wins'] = [(text(b), text(s)) for b, s in re.findall(r'<b>(.*?)</b><span>(.*?)</span>', wins, re.S)]
    facts = re.search(r'<div class="facts">(.*?)</div>\s*</section>', prof, re.S).group(1)
    d['facts'] = [(text(k), text(v)) for k, v in re.findall(r'<div><span>(.*?)</span><b>(.*?)</b></div>', facts, re.S)]

    d['xp'] = []
    for art in re.findall(r'<article class="xr.*?</article>', section(src, 'experiences'), re.S):
        g = lambda cls: (re.search(rf'<span class="{cls}">(.*?)</span>', art, re.S) or [None, ''])[1]
        pj = re.search(r'<p class="pj"><em>Projet</em>(.*?)</p>', art, re.S)
        d['xp'].append({'org': text(g('o')), 'sector': text(g('s')), 'dates': text(g('w')), 'now': 'class="now"' in art,
                        'role': text(re.search(r'<h3>(.*?)</h3>', art, re.S).group(1)), 'project': text(pj.group(1)) if pj else '',
                        'items': [text(li, keep_bold=True) for li in re.findall(r'<li>(.*?)</li>', art, re.S)],
                        'tags': [text(t) for t in re.findall(r'<span class="tag">(.*?)</span>', art)]})
    d['skills'] = [(text(k), [text(t) for t in re.findall(r'<span class="tag">(.*?)</span>', tags)])
                   for k, tags in re.findall(r'<div class="rv"><span>(.*?)</span><div class="tags">(.*?)</div></div>', section(src, 'competences'), re.S)]
    cert = section(src, 'certifications')
    d['certs_lede'] = text(re.search(r'<p class="lede[^"]*"[^>]*>(.*?)</p>', cert, re.S).group(1))
    d['certs'] = []
    for art in re.findall(r'<article class="ce-card.*?</article>', cert, re.S):
        meta = dict((text(k), text(v)) for k, v in re.findall(r'<dt>(.*?)</dt><dd>(.*?)</dd>', art, re.S))
        d['certs'].append({'cat': text(re.search(r'<span class="ce-cat">(.*?)</span>', art).group(1)), 'title': text(re.search(r'<h3>(.*?)</h3>', art).group(1)),
                           'by': meta.get('Délivré par', ''), 'date': meta.get('Le', ''), 'hours': meta.get('Durée', ''),
                           'url': re.search(r'class="ce-link" href="([^"]+)"', art).group(1), 'feat': 'feat' in art.split('"', 2)[1],
                           'icon': re.search(r'<span class="ce-ic"><i class="([^"]+)"', art).group(1)})
    form = section(src, 'formation')
    d['edu'] = [(text(y), text(b), text(rest)) for y, b, rest in re.findall(r'<span class="y">(.*?)</span><b>(.*?)</b>(.*?)</div>', form, re.S)]
    d['langs'] = [(text(b), text(s), int(w)) for b, s, w in re.findall(r'<div><b>(.*?)</b><span>(.*?)</span><div class="bar"><i style="--w:(\d+)%">', form, re.S)]
    proj = section(src, 'projet')
    d['project'] = {'name': text(re.search(r'<h2[^>]*>(.*?)</h2>', proj, re.S).group(1)).rstrip('.'),
                    'text': text(re.search(r'<div class="rv"[^>]*>\s*<p>(.*?)</p>', proj, re.S).group(1)),
                    'items': [text(li).lstrip('— ') for li in re.findall(r'<li>(.*?)</li>', proj, re.S)],
                    'tags': [text(t) for t in re.findall(r'<span class="tag">(.*?)</span>', proj)],
                    'links': [(u, text(l)) for u, l in re.findall(r'<a class="plink" href="([^"]+)"[^>]*>(.*?)</a>', proj, re.S)]}
    c = re.search(r"var CONTACT = \{ email: '([^']*)', phone: '([^']*)'", src)
    d['email'], d['phone'] = c.group(1), c.group(2)
    if len(d['xp']) < 3 or len(d['skills']) < 6 or not d['certs']:
        raise SystemExit('lecture de index.html incomplète')
    return d


# ============================================================================ ressources
def data_uri(path: pathlib.Path, mime: str) -> str:
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


def font_css() -> str:
    f = ROOT / 'assets' / 'fonts'
    faces = [('Space Grotesk', 'space-grotesk', '400 700'), ('Inter', 'inter', '400 600'), ('JetBrains Mono', 'jetbrains-mono', '400 500')]
    css = ''.join(f"@font-face{{font-family:'{n}';font-weight:{w};src:url({data_uri(f / (k + '-latin.woff2'), 'font/woff2')}) format('woff2')}}"
                  f"@font-face{{font-family:'{n}';font-weight:{w};unicode-range:U+0100-024F,U+1E00-1EFF;src:url({data_uri(f / (k + '-latin-ext.woff2'), 'font/woff2')}) format('woff2')}}"
                  for n, k, w in faces)
    fa = (ROOT / 'assets' / 'fa' / 'css' / 'all.min.css').read_text(encoding='utf-8')
    for name in ['fa-solid-900', 'fa-regular-400', 'fa-brands-400']:
        fa = fa.replace(f'../webfonts/{name}.woff2', data_uri(ROOT / 'assets' / 'fa' / 'webfonts' / f'{name}.woff2', 'font/woff2'))
    return css + fa


def still(path: pathlib.Path, width: int = 900) -> str:
    from PIL import Image
    with Image.open(path) as im:
        n = getattr(im, 'n_frames', 1)
        if n > 1:
            im.seek(n // 3)
        frame = im.convert('RGB')
        if frame.width > width:
            frame = frame.resize((width, round(frame.height * width / frame.width)))
        buf = io.BytesIO()
        frame.save(buf, format='JPEG', quality=84)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def photo() -> str:
    return data_uri(ROOT / 'assets' / 'kenza.webp', 'image/webp')


def qr() -> str:
    svg = (ROOT / 'assets' / 'qr-cv.svg').read_text(encoding='utf-8')
    if 'viewBox' not in svg:  # sans viewBox, le QR serait rogné au lieu d'être mis à l'échelle
        m = re.search(r'<svg[^>]*width="(\d+)" height="(\d+)"', svg)
        svg = svg.replace(m.group(0), m.group(0) + f' viewBox="0 0 {m.group(1)} {m.group(2)}"', 1)
    return svg[svg.index('<svg'):]


def contacts(d: dict) -> list[tuple[str, str, str]]:
    return [('fa-regular fa-envelope', d['email'], 'mailto:' + d['email']),
            ('fa-solid fa-phone', d['phone'], 'tel:' + d['phone'].replace(' ', '')),
            ('fa-solid fa-globe', 'cv-kenza.my-officeapps.com', SITE)]


def contact_links(d: dict) -> str:
    return ''.join(f'<a href="{e(u)}"><i class="{i}"></i>{e(t)}</a>' for i, t, u in contacts(d))


# ============================================================================ système visuel (repris du site)
BASE = '''
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#1d1813;--muted:#5f5850;--faint:#736a5f;--line:#e3dbcf;--paper:#fffdf9;--bg:#f8f4ee;--accent:#7d5c38;--beige:#d8c3a5;--soft:#f1e7d8;
  --panel:#1d1813;--pink:#f3ede4;--pacc:#d8c3a5;--pic-a:#efe3cf;--pic-b:#c9ad85}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Inter',sans-serif;color:var(--ink);background:var(--paper);font-size:8.4pt;line-height:1.45}
a{color:inherit;text-decoration:none}b{font-weight:600}
.page{width:210mm;height:297mm;display:grid;grid-template-columns:62mm 1fr;overflow:hidden;page-break-after:always;position:relative}
.page:last-child{page-break-after:auto}
.side{background:var(--panel);color:var(--pink);padding:10mm 7.5mm 9mm;display:flex;flex-direction:column;gap:4.6mm;position:relative;overflow:hidden}
.side>*{position:relative}
.side .who{font:700 10.5pt 'Space Grotesk';letter-spacing:-.01em}.side .who span,.acc{color:var(--pacc)}
.pic{width:100%;aspect-ratio:1;border-radius:7mm;overflow:hidden;background:linear-gradient(160deg,var(--pic-a),var(--pic-b))}
.pic img{width:100%;height:100%;object-fit:cover;object-position:50% 8%;display:block}
.big{font:700 30mm/.82 'Space Grotesk';letter-spacing:-.07em;color:transparent;-webkit-text-stroke:.35mm #5c4c3a}
.tt{font:700 21pt/1 'Space Grotesk';letter-spacing:-.05em;margin-top:-1mm}.tt span{color:var(--pacc)}
.desc{font-size:8.2pt;color:#d9d0c3;line-height:1.5}
.prog{display:flex;gap:1.2mm}.prog i{flex:1;height:.6mm;background:#3d342b}.prog i.on{background:var(--pacc)}
.sl{font:500 6.6pt 'JetBrains Mono';color:var(--pacc);text-transform:uppercase;letter-spacing:.12em;border-bottom:.25mm solid #3d342b;padding-bottom:1.2mm;margin-bottom:1.6mm}
.cts{display:flex;flex-direction:column;gap:1.5mm;font:500 7pt 'JetBrains Mono'}.cts a{display:flex;align-items:center;gap:2mm}.cts i{color:var(--pacc);width:3mm;text-align:center}
.lg div{display:grid;grid-template-columns:1fr auto;font-size:7.6pt;margin-bottom:1.6mm}.lg span{font:6.6pt 'JetBrains Mono';color:#b8ad9e}
.lg em{grid-column:1/-1;height:.7mm;background:#3d342b;margin-top:.8mm;position:relative}.lg em i{position:absolute;inset:0 auto 0 0;background:var(--pacc)}
.qrb{display:flex;gap:3mm;align-items:center;margin-top:auto}.qrb .q{background:#fffdf9;border-radius:2mm;padding:1.4mm;width:19mm;height:19mm;flex-shrink:0}
.qrb svg{width:100%;height:100%;display:block}.qrb p{font:6.4pt 'JetBrains Mono';color:#b8ad9e;line-height:1.45}.qrb b{color:var(--pink);font-weight:500}
.main{padding:10mm 10.5mm 9mm 9.5mm;display:flex;flex-direction:column;min-width:0}
.eb{font:500 7.2pt 'JetBrains Mono';color:var(--accent);letter-spacing:.02em}
h2.st{font:700 16pt/1.06 'Space Grotesk';letter-spacing:-.035em;margin:1.2mm 0 2.4mm}
.lede{font-size:8.7pt;color:#3b342c;line-height:1.5}
.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-top:3.4mm}.kp div{border-top:.35mm solid var(--ink);padding-top:1.4mm}
.kp b{font:700 13.5pt/1.05 'Space Grotesk';letter-spacing:-.04em;display:block}.kp span{font:6.6pt 'JetBrains Mono';color:var(--muted)}
.wins{display:grid;grid-template-columns:repeat(4,1fr);gap:2.4mm;margin-top:3.4mm}
.wins div{background:var(--soft);border-radius:3mm;padding:2.2mm 2.4mm}.wins b{font:700 11.5pt 'Space Grotesk';letter-spacing:-.03em;color:var(--accent);display:block}.wins span{font-size:6.9pt;color:#4a4238;line-height:1.35;display:block;margin-top:.6mm}
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:1.6mm 4mm;margin-top:3.4mm}.facts div{border-top:.25mm solid var(--line);padding-top:1mm}
.facts span{font:6.4pt 'JetBrains Mono';color:var(--muted);display:block}.facts b{font:600 7.8pt 'Space Grotesk'}
.sec{margin-top:5mm}
.tg{display:flex;flex-wrap:wrap;gap:1mm;margin-top:1.4mm}.tg span{font:6.5pt 'JetBrains Mono';border:.25mm solid var(--line);border-radius:9mm;padding:.2mm 1.6mm;color:var(--muted);background:var(--paper);white-space:nowrap}
.xr{display:grid;grid-template-columns:27mm 1fr;gap:3.4mm;border-top:.3mm solid var(--line);padding:2.4mm 0 2mm}
.xr .o{font:700 9.4pt/1.15 'Space Grotesk';display:block;letter-spacing:-.015em}.xr .s{font:6.6pt 'JetBrains Mono';color:var(--muted);display:block;margin-top:.6mm}
.xr .w{font:6.6pt 'JetBrains Mono';color:var(--accent);display:block;margin-top:.8mm}
.now{display:inline-block;margin-top:1.2mm;font:500 6.2pt 'JetBrains Mono';background:var(--ink);color:var(--pacc);border-radius:9mm;padding:.3mm 1.8mm}
.xr h3{font:600 9.2pt 'Space Grotesk';letter-spacing:-.01em}.xr .pj{font-size:7.9pt;color:#3b342c;margin-top:.6mm}.xr .pj em{font:normal 500 6.4pt 'JetBrains Mono';color:var(--accent);margin-right:1.4mm;text-transform:uppercase;letter-spacing:.08em}
.xr ul{list-style:none;margin-top:1.2mm}.xr li{font-size:7.6pt;color:#3b342c;padding-left:3mm;position:relative;margin-bottom:.5mm}.xr li::before{content:"—";position:absolute;left:0;color:var(--accent)}
.xr li b{color:var(--ink)}
.ce{display:grid;grid-template-columns:1.2fr 1fr;gap:3mm}
.ce a{border:.3mm solid var(--line);border-radius:3mm;padding:2.6mm 3mm;background:#fff;display:block}.ce a.feat{background:linear-gradient(140deg,var(--soft),#fff 70%);border-color:#d9c6aa}
.ce i.ic{width:7mm;height:7mm;border-radius:2mm;display:inline-grid;place-items:center;background:var(--panel);color:var(--pink);font-size:8pt}
.ce .ok{float:right;font:500 6pt 'JetBrains Mono';color:#1a7f4b;background:#e3f4ea;border-radius:9mm;padding:.3mm 1.6mm}
.ce .cat{display:block;font:6.4pt 'JetBrains Mono';color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-top:1.6mm}
.ce h4{font:600 9pt/1.2 'Space Grotesk';margin-top:.6mm}.ce p{font:6.6pt 'JetBrains Mono';color:var(--muted);margin-top:.8mm}
.ed>div{display:grid;grid-template-columns:12mm 1fr;gap:2mm;border-top:.25mm solid var(--line);padding:1.4mm 0}.ed .y{font:700 11pt 'Space Grotesk';color:var(--beige);letter-spacing:-.03em}
.ed b{display:block;font:600 8.4pt 'Space Grotesk'}.ed span:not(.y){display:block;font-size:7.3pt;color:var(--muted)}
.foot{margin-top:auto;padding-top:3mm;border-top:.3mm solid var(--line);display:flex;justify-content:space-between;font:6.6pt 'JetBrains Mono';color:var(--muted)}
.cta{background:var(--beige);color:var(--ink);border-radius:4mm;padding:4.4mm 5mm;display:flex;justify-content:space-between;align-items:center;gap:4mm}
.cta h3{font:700 14pt/1.05 'Space Grotesk';letter-spacing:-.04em}.cta h3 span{color:#5c4426}.cta p{font-size:7.8pt;color:#3b2f22;margin-top:1mm}
.cta .q{background:#fffdf9;border-radius:2mm;padding:1.3mm;width:20mm;height:20mm;flex-shrink:0}.cta svg{width:100%;height:100%;display:block}
'''


def head(title: str, css: str = '') -> str:
    return f'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>{e(title)}</title><style>{font_css()}{BASE}{css}</style></head><body>'


def prog(on: int, n: int = 7) -> str:
    return '<div class="prog">' + ''.join(f'<i class="{"on" if i < on else ""}"></i>' for i in range(n)) + '</div>'


def xp_html(x: dict, full: bool = True) -> str:
    items = x['items'] if full else x['items'][:4]
    now = '<span class="now">En poste</span>' if x['now'] else ''
    pj = '<p class="pj"><em>Projet</em>' + e(x['project']) + '</p>' if x['project'] else ''
    lis = ''.join('<li>' + li + '</li>' for li in items)
    tags = ''.join('<span>' + e(t) + '</span>' for t in x['tags'])
    return (f'<article class="xr"><div><span class="o">{e(x["org"])}</span><span class="s">{e(x["sector"])}</span>'
            f'<span class="w">{e(x["dates"])}</span>{now}</div><div><h3>{e(x["role"])}</h3>{pj}<ul>{lis}</ul><div class="tg">{tags}</div></div></article>')


def certs_html(d: dict) -> str:
    return '<div class="ce">' + ''.join(
        f'<a class="{"feat" if c["feat"] else ""}" href="{e(c["url"])}"><i class="ic {e(c["icon"])}"></i><span class="ok">✓ Certificat vérifié</span>'
        f'<span class="cat">{e(c["cat"])}</span><h4>{e(c["title"])}</h4><p>{e(c["by"])} · {e(c["date"])} · {e(c["hours"])}</p></a>' for c in d['certs']) + '</div>'


def edu_html(d: dict) -> str:
    return '<div class="ed">' + ''.join(f'<div><span class="y">{e(y)}</span><div><b>{e(b)}</b><span>{e(r)}</span></div></div>' for y, b, r in d['edu']) + '</div>'


def langs_html(d: dict) -> str:
    return '<div class="lg">' + ''.join(f'<div><b>{e(n)}</b><span>{e(l)}</span><em><i style="width:{w}%"></i></em></div>' for n, l, w in d['langs']) + '</div>'


def side(d: dict, number: str, title: str, desc: str, on: int, extra: str = '') -> str:
    return (f'<aside class="side"><div class="who">{e(NAME)}<span>.</span></div>'
            f'<div class="pic"><img src="{photo()}" alt=""></div>'
            f'<div><div class="big">{number}</div><div class="tt">{e(title)}<span>.</span></div></div>'
            f'<p class="desc">{e(desc)}</p>{prog(on)}{extra}'
            f'<div class="qrb"><div class="q">{qr()}</div><p><b>CV interactif</b><br>démo et prise<br>de rendez-vous</p></div></aside>')


# ============================================================================ CV (A4, 2 pages)
def cv_html(d: dict) -> str:
    xp = d['xp']
    side1 = side(d, '01', 'Profil', d['desc'], 3, f'<div><div class="sl">Contact</div><div class="cts">{contact_links(d)}</div></div>'
                 f'<div><div class="sl">Langues</div>{langs_html(d)}</div>')
    skills = ''.join(f'<div style="margin-bottom:2mm"><div style="font:500 6.5pt JetBrains Mono;color:#d8c3a5;text-transform:uppercase;letter-spacing:.08em">{e(k)}</div>'
                     f'<div style="font-size:7.2pt;color:#e7dfd3;line-height:1.4">{e(" · ".join(v))}</div></div>' for k, v in d['skills'])
    side2 = (f'<aside class="side"><div class="who">{e(NAME)}<span>.</span></div><div><div class="big">02</div><div class="tt">Stack<span>.</span></div></div>'
             f'<div>{skills}</div><div class="qrb"><div class="q">{qr()}</div><p><b>cv-kenza</b><br>.my-officeapps.com</p></div></aside>')
    split = 2
    p = d['project']
    proj = (f'<div class="xr" style="grid-template-columns:27mm 1fr"><div><span class="o">{e(p["name"])}</span><span class="s">Projet personnel</span></div>'
            f'<div><p class="pj" style="margin:0">{e(p["text"])}</p><ul>{"".join(f"<li>{e(i)}</li>" for i in p["items"])}</ul>'
            f'<div class="tg">{"".join(f"<span>{e(t)}</span>" for t in p["tags"])}</div></div></div>')
    return head(NAME + ' — CV') + f'''
<section class="page">{side1}<div class="main">
  <span class="eb">01 — Profil</span><h2 class="st">{e(d["statement"])}</h2><p class="lede">{e(d["lede"])}</p>
  <div class="kp">{"".join(f"<div><b>{e(n)}</b><span>{e(l)}</span></div>" for n, l in d["kp"])}</div>
  <div class="wins">{"".join(f"<div><b>{e(b)}</b><span>{e(s)}</span></div>" for b, s in d["wins"])}</div>
  <div class="sec"><span class="eb">02 — Expériences</span><h2 class="st">Cinq contextes, une même exigence.</h2>{"".join(xp_html(x) for x in xp[:split])}</div>
  <div class="foot"><span>{e(NAME)} · CV</span><span>1 / 2</span></div></div></section>
<section class="page">{side2}<div class="main">
  {"".join(xp_html(x) for x in xp[split:])}
  <div class="sec"><span class="eb">04 — Certifications</span><h2 class="st" style="font-size:13pt">Formation continue, certifiée.</h2>{certs_html(d)}</div>
  <div class="sec"><span class="eb">05 — Formation & langues</span><div style="margin-top:1.6mm">{edu_html(d)}</div></div>
  <div class="sec"><span class="eb">06 — Projet personnel</span><div style="margin-top:1mm">{proj}</div></div>
  <div class="foot"><span>{e(NAME)} · CV · cv-kenza.my-officeapps.com</span><span>2 / 2</span></div></div></section></body></html>'''


# ============================================================================ présentation (A4, 1 page)
def presentation_html(d: dict) -> str:
    css = '''
.hero h1{font:700 19pt/1.04 'Space Grotesk';letter-spacing:-.04em;margin:1.6mm 0 2.6mm}.hero h1 span{color:var(--accent)}
.missions{margin-top:1.6mm}.mi{display:grid;grid-template-columns:30mm 1fr auto;gap:3mm;border-top:.25mm solid var(--line);padding:1.2mm 0;align-items:baseline}
.mi b{font:600 8.6pt 'Space Grotesk'}.mi span{font-size:7.5pt;color:#3b342c}.mi em{font:normal 6.4pt 'JetBrains Mono';color:var(--accent);white-space:nowrap}
.stk{display:grid;grid-template-columns:repeat(2,1fr);gap:2mm 5mm;margin-top:1.6mm}.stk div{border-top:.25mm solid var(--line);padding-top:1mm}
.stk b{font:500 6.6pt 'JetBrains Mono';color:var(--accent);text-transform:uppercase;letter-spacing:.06em;display:block}.stk span{font-size:7.5pt;color:#3b342c}
'''
    keys = ['Back-end', 'Front-end', 'Données', 'Cloud', 'CI/CD', 'Méthode']
    sk = dict(d['skills'])
    stack = ''.join(f'<div><b>{e(k)}</b><span>{e(" · ".join(sk.get(k, [])))}</span></div>' for k in keys if k in sk)
    def one_line(t, n=72):
        t = re.split(r' \(|, | : ', t)[0]
        return t if len(t) <= n else t[:n].rsplit(' ', 1)[0].rstrip(',;:') + '…'
    missions = ''.join(f'<div class="mi"><b>{e(x["org"])}</b><span>{e(one_line(x["project"] or x["role"]))}</span><em>{e(x["sector"])}</em></div>' for x in d['xp'])
    extra = (f'<div><div class="sl">Contact</div><div class="cts">{contact_links(d)}</div></div><div><div class="sl">Langues</div>{langs_html(d)}</div>')
    return head(NAME + ' — Présentation', css) + f'''
<section class="page">{side(d, '01', 'Présentation', d['desc'], 1, extra)}<div class="main">
  <div class="hero"><span class="eb">Développeuse Full-Stack .NET / Angular · Ingénieure EILCO</span><h1>{e(d["statement"])}</h1></div>
  <p class="lede">{e(d["lede"])}</p>
  <div class="kp">{"".join(f"<div><b>{e(n)}</b><span>{e(l)}</span></div>" for n, l in d["kp"])}</div>
  <div class="wins">{"".join(f"<div><b>{e(b)}</b><span>{e(s)}</span></div>" for b, s in d["wins"])}</div>
  <div class="sec"><span class="eb">Missions & secteurs</span><div class="missions">{missions}</div></div>
  <div class="sec"><span class="eb">Stack</span><div class="stk">{stack}</div></div>
  <div class="sec"><span class="eb">Certifiée en 2026</span><div style="margin-top:1.6mm">{certs_html(d)}</div></div>
  <div style="margin-top:auto;padding-top:4mm"><div class="cta"><div><h3>Un projet .NET / Angular ?<br>Parlons-en<span>.</span></h3><p>Réservez un échange de 30 min sur cv-kenza.my-officeapps.com, ou écrivez-moi directement.</p></div><div class="q">{qr()}</div></div></div>
</div></section></body></html>'''


# ============================================================================ carte de visite (85 × 55 mm)
def card_html(d: dict) -> str:
    css = '''
@page{size:85mm 55mm;margin:0}
.c{width:85mm;height:55mm;position:relative;overflow:hidden;page-break-after:always;padding:5mm 5.5mm}.c:last-child{page-break-after:auto}
.r{background:#1d1813;color:#f3ede4}.r>*{position:relative}
.r .wk{position:absolute;right:-2mm;bottom:-8mm;font:700 38mm/1 'Space Grotesk';letter-spacing:-.07em;color:transparent;-webkit-text-stroke:.25mm #3d342b}
.r .tp{font:500 5.6pt 'JetBrains Mono';letter-spacing:.12em;color:#b8ad9e;display:flex;align-items:center;gap:1.6mm}.r .tp i{width:1.8mm;height:1.8mm;border-radius:50%;background:#d8c3a5;display:inline-block}
.r h1{font:700 19pt/.95 'Space Grotesk';letter-spacing:-.045em;margin-top:6.5mm}.r h1 span{color:#d8c3a5}
.r .pic{position:absolute;right:5.5mm;top:9mm;width:16mm;height:16mm;border-radius:3mm}
.r .rl{position:absolute;left:5.5mm;right:5.5mm;bottom:5mm;border-top:.25mm solid #3d342b;padding-top:2mm;display:flex;justify-content:space-between;font:500 5.8pt 'JetBrains Mono';color:#d9d0c3}.r .rl b{color:#fff;font-weight:500}
.v{background:#fffdf9;display:grid;grid-template-columns:minmax(0,1fr) 18mm;gap:3mm}
.v h2{font:700 10.5pt/1.05 'Space Grotesk';letter-spacing:-.03em}.v h2 span{color:#7d5c38}
.v .ls{margin-top:3mm;display:flex;flex-direction:column;gap:1.4mm;font:500 6pt 'JetBrains Mono';white-space:nowrap}.v .ls a{display:flex;align-items:center;gap:1.6mm}.v .ls i{color:#7d5c38;width:2.6mm;text-align:center}
.v .q{align-self:center;margin-top:-3mm}.v .q svg{width:18mm;height:18mm;display:block}.v .q p{font:5pt 'JetBrains Mono';color:#5f5850;text-align:center;margin-top:1mm;line-height:1.25}
.v .bt{position:absolute;left:5.5mm;right:5.5mm;bottom:4mm;border-top:.25mm solid #e3dbcf;padding-top:1.6mm;font:5.4pt 'JetBrains Mono';color:#5f5850;display:flex;justify-content:space-between}
'''
    ls = ''.join(f'<a href="{e(u)}"><i class="{i}"></i>{e(t)}</a>' for i, t, u in contacts(d))
    return head(NAME + ' — Carte de visite', css) + f'''
<section class="c r"><span class="wk">K.</span><div class="tp"><i></i>.NET · ANGULAR · AZURE</div>
  <div class="pic"><img src="{photo()}" alt=""></div><h1>Kenza<br>SKALLI<span>.</span></h1>
  <div class="rl"><b>Développeuse Full-Stack .NET / Angular</b><span>4 ans</span></div></section>
<section class="c v"><div><h2>Un projet .NET / Angular ?<br>Parlons-en<span>.</span></h2><div class="ls">{ls}</div></div>
  <div class="q">{qr()}<p>CV, démo<br>&amp; rendez-vous</p></div>
  <div class="bt"><span>Ingénieure EILCO · Full-Stack .NET / Angular</span><span>Certifiée IA 2026</span></div></section></body></html>'''


# ============================================================================ dossier de compétences (A4)
def dossier_html(d: dict) -> str:
    css = '''
.band{grid-template-columns:14mm 1fr}
.band .side{padding:9mm 0;align-items:center;justify-content:space-between}
.band .vt{writing-mode:vertical-rl;transform:rotate(180deg);font:500 6.8pt 'JetBrains Mono';letter-spacing:.14em;text-transform:uppercase;color:#b8ad9e}
.band .num{font:700 15pt 'Space Grotesk';color:var(--pacc);letter-spacing:-.04em}
.skg{display:grid;grid-template-columns:1fr 1fr;gap:3mm 6mm;margin-top:2mm}.skg div{border-top:.3mm solid var(--line);padding-top:1.4mm}
.skg b{font:500 6.8pt 'JetBrains Mono';color:var(--accent);text-transform:uppercase;letter-spacing:.07em}
.toc a{display:grid;grid-template-columns:9mm 1fr auto;gap:2mm;border-top:.25mm solid var(--line);padding:1.8mm 0;font-size:8.6pt;align-items:baseline}
.toc em{font:normal 500 7pt 'JetBrains Mono';color:var(--accent)}.toc small{font:6.8pt 'JetBrains Mono';color:var(--muted)}
.cover h1{font:700 30pt/.98 'Space Grotesk';letter-spacing:-.05em;margin:2mm 0 3mm}.cover h1 span{color:var(--accent)}
.prj{display:grid;grid-template-columns:52mm 1fr;gap:5mm;align-items:start}.prj img{width:100%;border-radius:3mm}
'''
    xp = d['xp']
    pages = []
    total = 4

    def band(no: str, label: str, body: str, page: int) -> str:
        return (f'<section class="page band"><aside class="side"><span class="num">{no}</span><span class="vt">{e(NAME)} · Dossier de compétences · {e(label)}</span></aside>'
                f'<div class="main">{body}<div class="foot"><span>{e(NAME)} · Dossier de compétences</span><span>{page} / {total}</span></div></div></section>')

    toc = [('01', 'Compétences', 'Stack détaillée et langues', 2), ('02', 'Missions', f'{len(xp)} expériences, réalisations et environnement', 3),
           ('03', 'Certifications & formation', 'Formation continue 2026, diplôme, projet personnel', 4)]
    toc_html = ''.join(f'<a href="#p{p}"><em>{n}</em><span><b>{e(t)}</b> — {e(s)}</span><small>p. {p}</small></a>' for n, t, s, p in toc)
    extra = f'<div><div class="sl">Contact</div><div class="cts">{contact_links(d)}</div></div><div><div class="sl">Langues</div>{langs_html(d)}</div>'
    cover = f'''<section class="page cover">{side(d, "00", "Dossier", d["desc"], 1, extra)}<div class="main">
  <span class="eb">Dossier de compétences · 2026</span><h1>{e(NAME)}<span>.</span></h1>
  <div style="font:600 12pt 'Space Grotesk';letter-spacing:-.02em">Développeuse Full-Stack .NET / Angular</div>
  <p class="lede" style="margin-top:3mm">{e(d["lede"])}</p>
  <div class="kp">{"".join(f"<div><b>{e(n)}</b><span>{e(l)}</span></div>" for n, l in d["kp"])}</div>
  <div class="facts">{"".join(f"<div><span>{e(k)}</span><b>{e(v)}</b></div>" for k, v in d["facts"])}</div>
  <div class="sec"><span class="eb">Résultats clés</span><div class="wins" style="margin-top:1.6mm">{"".join(f"<div><b>{e(b)}</b><span>{e(s)}</span></div>" for b, s in d["wins"])}</div></div>
  <div class="sec"><span class="eb">Sommaire</span><div class="toc" style="margin-top:1.6mm">{toc_html}</div></div>
  <div style="margin-top:auto;padding-top:4mm"><div class="cta"><div><h3>Un projet .NET / Angular ?<br>Parlons-en<span>.</span></h3><p>Réservez un échange de 30 min sur cv-kenza.my-officeapps.com · {e(d["email"])} · {e(d["phone"])}</p></div><div class="q">{qr()}</div></div></div>
  <div class="foot"><span>{e(NAME)} · Dossier de compétences</span><span>1 / {total}</span></div></div></section>'''
    skg = ''.join(f'<div><b>{e(k)}</b><div class="tg">{"".join(f"<span>{e(t)}</span>" for t in v)}</div></div>' for k, v in d['skills'])
    pages.append(band('01', 'Compétences', f'''<span class="eb" id="p2">01 — Compétences</span><h2 class="st">Une stack complète, du SQL au front.</h2>
  <div class="skg">{skg}</div>
  <div class="sec"><span class="eb">Langues</span><div class="kp" style="grid-template-columns:repeat(3,1fr)">{"".join(f"<div><b>{e(n)}</b><span>{e(l)}</span></div>" for n, l, w in d["langs"])}</div></div>''', 2))
    pages.append(band('02', 'Missions', f'''<span class="eb" id="p3">02 — Missions</span><h2 class="st">Cinq contextes, une même exigence.</h2>
  {"".join(xp_html(x) for x in xp)}''', 3))
    p = d['project']
    img = ROOT / 'assets' / 'pirates-dice.webp'
    links = ''.join(f'<a class="eb" style="border-bottom:.25mm solid var(--accent);margin-right:4mm" href="{e(u)}">{e(l)} ↗</a>' for u, l in p['links'])
    pages.append(band('03', 'Certifications', f'''<span class="eb" id="p4">03 — Certifications</span><h2 class="st">Formation continue, certifiée.</h2>
  <p class="lede">{e(d["certs_lede"])}</p><div style="margin-top:3mm">{certs_html(d)}</div>
  <div class="sec"><span class="eb">Formation</span><div style="margin-top:1.6mm">{edu_html(d)}</div></div>
  <div class="sec"><span class="eb">Projet personnel</span><h2 class="st" style="font-size:13pt">{e(p["name"])}.</h2>
    <div class="prj"><img src="{still(img, 700)}" alt=""><div><p class="lede">{e(p["text"])}</p>
    <ul style="list-style:none;margin-top:1.6mm">{"".join(f"<li style='font-size:7.8pt;padding-left:3mm;position:relative'><span style='position:absolute;left:0;color:#7d5c38'>—</span>{e(i)}</li>" for i in p["items"])}</ul>
    <div class="tg">{"".join(f"<span>{e(t)}</span>" for t in p["tags"])}</div><div style="margin-top:2.4mm">{links}</div></div></div></div>
  <div style="margin-top:auto;padding-top:5mm"><div class="cta"><div><h3>Un projet .NET / Angular ?<br>Parlons-en<span>.</span></h3><p>Réservez un échange de 30 min sur cv-kenza.my-officeapps.com · {e(d["email"])} · {e(d["phone"])}</p></div><div class="q">{qr()}</div></div></div>''', 4))
    return head(NAME + ' — Dossier de compétences', css) + cover + ''.join(pages) + '</body></html>'


# ============================================================================ impression et publication
def render(name: str, page: str) -> pathlib.Path:
    BUILD.mkdir(parents=True, exist_ok=True)
    src = BUILD / f'{name}.html'
    src.write_text(page, encoding='utf-8')
    out = BUILD / f'{name}.pdf'
    if out.exists():
        out.unlink()
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
                    '--virtual-time-budget=4000', f'--print-to-pdf={out}', src.as_uri()], check=True, capture_output=True, timeout=120)
    if not out.exists():
        raise SystemExit(f'Chrome n’a pas produit {name}.pdf')
    return out


DOCUMENTS = [
    # id, fichier publié, titre affiché, titre du PDF (moteurs de recherche), description, constructeur
    ('cv', ROOT / 'assets' / 'Kenza-SKALLI-CV.pdf', 'Le CV', 'Kenza SKALLI — CV Développeuse Full-Stack .NET / Angular',
     'Profil, cinq expériences, compétences, certifications et formation.', cv_html),
    ('presentation', DOCS / 'Kenza-SKALLI-Presentation.pdf', 'La présentation', 'Kenza SKALLI — Présentation, développeuse Full-Stack .NET / Angular',
     'Une page : profil, résultats clés, missions et stack.', presentation_html),
    ('carte', DOCS / 'Kenza-SKALLI-Carte-de-visite.pdf', 'La carte de visite', 'Kenza SKALLI — Carte de visite',
     'Recto verso, avec un QR code vers le CV en ligne.', card_html),
    ('dossier', DOCS / 'Kenza-SKALLI-Dossier-de-competences.pdf', 'Le dossier de compétences', 'Kenza SKALLI — Dossier de compétences .NET / Angular',
     'Stack détaillée, missions complètes, certifications et formation.', dossier_html),
]


def docs_block(items: list[dict]) -> str:
    cards = ''.join(
        f'''<article class="doc"><a class="th" href="{e(i["file"])}" target="_blank" rel="noopener" aria-label="Ouvrir {e(i["title"].lower())} (PDF)"><img src="assets/documents/{i["id"]}-1.webp" alt="" loading="lazy" width="300" height="{212 if i["id"] == "carte" else 424}"></a>
      <div class="bd"><span class="no">{n:02d}</span><b>{e(i["title"])}</b><span>{e(i["desc"])}</span><em>{e(i["format"])} · {e(i["size"])}</em></div>
      <div class="ac"><a href="{e(i["file"])}" target="_blank" rel="noopener"><i class="fa-regular fa-eye"></i> Aperçu</a><a href="{e(i["file"])}" download><i class="fa-solid fa-arrow-down"></i> PDF</a></div></article>'''
        for n, i in enumerate(items, 1))
    return ('<!-- DOCUMENTS:START -->\n    <div class="docs rv" id="documents"><div class="docs-h"><h3>À emporter<span class="acc">.</span></h3><div>'
            '<a href="assets/documents/Kenza-SKALLI-Documents.zip" download><i class="fa-solid fa-arrow-down"></i> Tout télécharger <small>ZIP</small></a>'
            '<a href="assets/documents/Kenza-SKALLI.vcf" download><i class="fa-regular fa-address-card"></i> Ajouter à mes contacts <small>VCF</small></a></div></div>'
            f'<div class="docs-g">{cards}</div></div>\n    <!-- DOCUMENTS:END -->')


def inject(items: list[dict]) -> None:
    index = ROOT / 'index.html'
    src = index.read_text(encoding='utf-8')
    a, b = '<!-- DOCUMENTS:START -->', '<!-- DOCUMENTS:END -->'
    if a not in src:
        raise SystemExit('marqueurs DOCUMENTS absents de index.html')
    before, rest = src.split(a, 1)
    _, after = rest.split(b, 1)
    index.write_text(before + docs_block(items) + after, encoding='utf-8', newline='\n')


def main() -> list[dict]:
    d = read_site()
    DOCS.mkdir(parents=True, exist_ok=True)
    out = []
    for ident, target, title, pdf_title, desc, build in DOCUMENTS:
        pdf = fitz.open(render(ident, build(d)))
        pdf.set_metadata({'title': pdf_title, 'author': NAME, 'subject': desc, 'creator': 'cv-kenza.my-officeapps.com'})
        pdf.save(target, garbage=3, deflate=True)
        pix = pdf[0].get_pixmap(matrix=fitz.Matrix(1.6 if ident != 'carte' else 4, 1.6 if ident != 'carte' else 4), alpha=False)
        from PIL import Image
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        im.thumbnail((620, 620))
        im.save(DOCS / f'{ident}-1.webp', format='WEBP', quality=86)
        size = target.stat().st_size
        fmt = ('85 × 55 mm · recto / verso' if ident == 'carte' else f'A4 · {len(pdf)} page{"s" if len(pdf) > 1 else ""}')
        out.append({'id': ident, 'title': title, 'desc': desc, 'file': target.relative_to(ROOT).as_posix(), 'pages': len(pdf),
                    'format': fmt, 'size': f'{size / 1e6:.1f} Mo'.replace('.', ',') if size >= 1e6 else f'{round(size / 1e3)} Ko'})
        pdf.close()
    vcf = '\r\n'.join(['BEGIN:VCARD', 'VERSION:3.0', 'N:SKALLI;Kenza;;;', 'FN:' + NAME, 'TITLE:Développeuse Full-Stack .NET / Angular',
                       'EMAIL;TYPE=INTERNET:' + d['email'], 'TEL;TYPE=CELL:' + d['phone'].replace(' ', ''), 'URL:' + SITE, 'END:VCARD', ''])
    (DOCS / 'Kenza-SKALLI.vcf').write_bytes(vcf.encode('utf-8'))
    with zipfile.ZipFile(DOCS / 'Kenza-SKALLI-Documents.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for item in out:
            z.write(ROOT / item['file'], pathlib.Path(item['file']).name)
        z.write(DOCS / 'Kenza-SKALLI.vcf', 'Kenza-SKALLI.vcf')
    inject(out)
    return out


if __name__ == '__main__':
    for doc in main():
        print(f'{doc["title"]:28} {doc["format"]:30} {doc["size"]:>8}  {doc["file"]}')
