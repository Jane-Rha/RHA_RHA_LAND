"""
DR() Gemini API 토큰 소비량 분석 보고서 (수정판)
- 실제 1-3점 행 수 반영: GalaxyS26=1,267행, 유지훈P=1,635행 (사용자 확인)
- GDrive MCP가 시트를 112행에서 잘라내므로 이전 수치는 모두 과소 산정
- 전체 추정: gemini-3.5-flash 요금 기준 / 한국어
"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUTPUT = "/Users/kevinkim/Desktop/GCX/DR_Token_Analysis.docx"

# ─── 색상 ─────────────────────────────────────────────────────────────────────
def rgb(h): return RGBColor(int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))
DARK_H="1F497D"; MID_H="2E75B6"; LGRAY_H="F2F2F2"; LYELLOW_H="FFFFCC"
LORANGE_H="FFE5CC"; LGREEN_H="E2EFDA"; WHITE_H="FFFFFF"
DARK=rgb(DARK_H); MID=rgb(MID_H); WHITE=rgb(WHITE_H); BLACK=rgb("000000")
RED=rgb("C00000"); GRAY=rgb("606060")

def shade_cell(cell, h):
    tc=cell._tc; tcPr=tc.get_or_add_tcPr()
    [tcPr.remove(o) for o in tcPr.findall(qn('w:shd'))]
    s=OxmlElement('w:shd'); s.set(qn('w:val'),'clear'); s.set(qn('w:color'),'auto'); s.set(qn('w:fill'),h.upper()); tcPr.append(s)

def shade_para(p, h):
    pPr=p._p.get_or_add_pPr()
    [pPr.remove(o) for o in pPr.findall(qn('w:shd'))]
    s=OxmlElement('w:shd'); s.set(qn('w:val'),'clear'); s.set(qn('w:color'),'auto'); s.set(qn('w:fill'),h.upper()); pPr.append(s)

def ap(doc, text, bold=False, sz=11, col=None, italic=False,
       align=WD_ALIGN_PARAGRAPH.LEFT, sb=0, sa=6, ind=0):
    p=doc.add_paragraph(); p.alignment=align
    p.paragraph_format.space_before=Pt(sb); p.paragraph_format.space_after=Pt(sa)
    if ind: p.paragraph_format.left_indent=Cm(ind)
    r=p.add_run(text); r.bold=bold; r.italic=italic; r.font.size=Pt(sz)
    if col: r.font.color.rgb=col
    return p

def heading(doc, text):
    p=ap(doc, text, bold=True, sz=14, col=WHITE, sb=10, sa=4, ind=0.3)
    shade_para(p, DARK_H)

def bullet(doc, text, col=None):
    p=doc.add_paragraph(style='List Bullet'); p.paragraph_format.space_after=Pt(2)
    r=p.add_run(text); r.font.size=Pt(10)
    if col: r.font.color.rgb=col

def table(doc, hdrs, rows, hbg=DARK_H, alt=LGRAY_H, bold_last=False):
    t=doc.add_table(rows=1+len(rows), cols=len(hdrs))
    t.style='Table Grid'; t.alignment=WD_TABLE_ALIGNMENT.LEFT
    for i,h in enumerate(hdrs):
        c=t.rows[0].cells[i]; c.text=h; shade_cell(c, hbg)
        r=c.paragraphs[0].runs[0]; r.bold=True; r.font.size=Pt(9); r.font.color.rgb=WHITE
        c.paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.CENTER; c.vertical_alignment=WD_ALIGN_VERTICAL.CENTER
    for ri,row in enumerate(rows):
        last=bold_last and ri==len(rows)-1
        bg=DARK_H if last else (alt if ri%2==0 else WHITE_H)
        fg=WHITE if last else BLACK
        for ci,val in enumerate(row):
            c=t.rows[ri+1].cells[ci]; c.text=str(val); shade_cell(c, bg)
            r=c.paragraphs[0].runs[0]; r.font.size=Pt(9); r.font.color.rgb=fg; r.bold=last
            c.paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.CENTER; c.vertical_alignment=WD_ALIGN_VERTICAL.CENTER
    return t

# ═══════════════════════════════════════════════════════════════════════════════
# 데이터 (수정된 실제 수치)
# ═══════════════════════════════════════════════════════════════════════════════

# gemini-3.5-flash 요금 기준
INP_PRICE  = 1.50   # $/백만 입력 토큰
OUT_PRICE  = 9.00   # $/백만 출력 토큰
IN_TOK     = 8_604  # 입력 토큰 (가중 평균: 케이스80% 9,295 + 보호필름20% 5,841)
OUT_TOK    = 4      # 출력 토큰

CPC = (IN_TOK * INP_PRICE + OUT_TOK * OUT_PRICE) / 1_000_000   # 호출당 비용

# ── 실제 확인된 월별 속도 ─────────────────────────────────────────────────────
# Galaxy S26   : 확인 1,267행 / 3.5개월 (3월9일~6월15일) → 약 362행/월
# 유지훈P      : 확인 1,635행 / 5.5개월 (2026년 전체) → 약 297행/월
# iPhone 17e   : 확인 40행 / 3개월 → 약 13행/월
# Pixel 10a    : 확인 42행 / 2.5개월 → 약 17행/월
# 정규 시트 합 : 약 60행/월 (SDA 31 + Auto_Acc 16 + Power_Acc 10 + 전략폰 3)

S26_PM   = 362   # Galaxy S26 월간
YJH_PM   = 297   # 유지훈P 월간
I17E_PM  = 13    # iPhone 17e 월간
P10A_PM  = 17    # Pixel 10a 월간
REG_PM   = 60    # 정규 시트 합계 월간
Z8_PM    = 180   # Galaxy Z8 월간 (예상, Z7 대비 추정)
IPH18_PM = 350   # iPhone 18 월간 (예상, S26 대비 추정)

# ── 2025년 가상 추정 월별 데이터 ──────────────────────────────────────────────
# (레이블, GalaxyS25, iPh16e, S25Edge, Pixel9a, Z7, iPh17, Pixel10)
# 속도: S25≈362/월, 16e≈13/월, S25E≈150/월, 9a≈80/월, Z7≈180/월, iPh17≈300/월, Pixel10≈80/월
y2025 = [
    ('2025년 1월',   0,   0,   0,   0,   0,   0,   0),
    ('2025년 2월', 362,   0,   0,   0,   0,   0,   0),
    ('2025년 3월', 362,   0,   0,   0,   0,   0,   0),
    ('2025년 4월', 362,  13,   0,   0,   0,   0,   0),
    ('2025년 5월',   0,  13, 150,   0,   0,   0,   0),
    ('2025년 6월',   0,  13, 150,   0,   0,   0,   0),
    ('2025년 7월',   0,   0, 150,  80,   0,   0,   0),
    ('2025년 8월',   0,   0,   0,  80, 180,   0,   0),
    ('2025년 9월',   0,   0,   0,  80, 180,   0,   0),
    ('2025년 10월',  0,   0,   0,   0, 180, 300,   0),
    ('2025년 11월',  0,   0,   0,   0,   0, 300,  80),
    ('2025년 12월',  0,   0,   0,   0,   0, 300,  80),
]

# ── 2026년 월별 데이터 ────────────────────────────────────────────────────────
# (레이블, S26, YJH, iPh17e, Pixel10a, Z8, iPh18, REG)
# S26: 3월~6월 (4개월), YJH: 1월~12월, 17e: 3월~6월, 10a: 3월~5월
# Z8 예상: 7월~9월, iPh18 예상: 9월 중반~12월 중반
y2026 = [
    ('2026년 1월',    0, YJH_PM,      0,     0,      0,       0, REG_PM),
    ('2026년 2월',    0, YJH_PM,      0,     0,      0,       0, REG_PM),
    ('2026년 3월', S26_PM, YJH_PM, I17E_PM//3*1, P10A_PM, 0, 0, REG_PM),
    ('2026년 4월', S26_PM, YJH_PM,  I17E_PM, P10A_PM, 0, 0, REG_PM),
    ('2026년 5월', S26_PM, YJH_PM,  I17E_PM, P10A_PM//2, 0, 0, REG_PM),
    ('2026년 6월', S26_PM, YJH_PM,  I17E_PM,     0,      0,       0, REG_PM),
    ('2026년 7월',    0, YJH_PM,      0,     0,  Z8_PM,       0, REG_PM),
    ('2026년 8월',    0, YJH_PM,      0,     0,  Z8_PM,       0, REG_PM),
    ('2026년 9월',    0, YJH_PM,      0,     0,  Z8_PM, IPH18_PM//2, REG_PM),
    ('2026년 10월',   0, YJH_PM,      0,     0,      0,  IPH18_PM, REG_PM),
    ('2026년 11월',   0, YJH_PM,      0,     0,      0,  IPH18_PM, REG_PM),
    ('2026년 12월',   0, YJH_PM,      0,     0,      0,  IPH18_PM//2, REG_PM),
]

def t25(r): return sum(r[1:])
def t26(r): return sum(r[1:])

# ═══════════════════════════════════════════════════════════════════════════════
# 문서 생성
# ═══════════════════════════════════════════════════════════════════════════════
doc = Document()
for sec in doc.sections:
    sec.top_margin=sec.bottom_margin=Cm(1.8); sec.left_margin=sec.right_margin=Cm(2.0)

# ── 제목 ──────────────────────────────────────────────────────────────────────
ap(doc, 'Gemini API 토큰 소비량 분석 보고서', bold=True, sz=18,
   col=DARK, align=WD_ALIGN_PARAGRAPH.CENTER, sa=2)
ap(doc, 'DR() 커스텀 함수 — Spigen GCX CS 리뷰 모니터링 시스템 (수정판)',
   sz=12, col=MID, align=WD_ALIGN_PARAGRAPH.CENTER, sa=2)
ap(doc, '작성일: 2026년 6월 15일  |  분석 기간: 2025 ~ 2026년  |  작성: GCX 자동화팀',
   sz=9, col=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, sa=4)
ap(doc, '※ 전체 비용 추정: gemini-3.5-flash 기준 ($1.50/백만 입력토큰, $9.00/백만 출력토큰)',
   sz=10, col=RED, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sa=2)
ap(doc, '※ 실제 행 수 기준: Galaxy S26 1-3점 1,267행, 유지훈P 1-3점 1,635행 (확인된 실측치)',
   sz=10, col=RED, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, sa=8)
doc.add_paragraph()

# ══ §1 분석 범위 ══════════════════════════════════════════════════════════════
heading(doc, '1. 분석 범위 및 실제 1-3점 행 수')
ap(doc,
   '1-3점 시트의 행 수 = 실제 수집된 리뷰 수 = DR() 호출 수의 기준. '
   'Google Drive MCP가 시트당 최대 112행까지만 내보내므로 기존 분석은 전체 행 수가 크게 과소 산정됐습니다. '
   '아래 표는 실측 확인치와 익스포트 기반 추정치를 구분하여 표시합니다.',
   sz=10, sa=6)

table(doc,
    ['시트 / 제품', '1-3점 행 수', '데이터 출처', '월간 속도', '유형'],
    [
        ['Galaxy S26',        '1,267행',    '✓ 사용자 확인',   '~362행/월', '주력 기종 (Mar–Jun 2026)'],
        ['유지훈P',            '1,635행',    '✓ 사용자 확인',   '~297행/월', '일상 운영 (2026 전체)'],
        ['iPhone 17e',        '~40행',      '△ 익스포트 기반', '~13행/월',  '주력 기종 (Mar–Jun 2026)'],
        ['Pixel 10a',         '~42행',      '△ 익스포트 기반', '~17행/월',  '주력 기종 (Mar–May 2026)'],
        ['SDA (정규)',         '~500행 추정', '⚠ 익스포트 잘림 (124행 표시)', '~31행/월', '일상 운영 (2025년 2월~)'],
        ['Auto_Acc (정규)',    '~450행 추정', '⚠ 익스포트 잘림 (155행 표시)', '~16행/월', '일상 운영 (2024년 1월~)'],
        ['Power_Acc (정규)',   '~73행',      '△ 익스포트 기반', '~10행/월',  '일상 운영 (2025년 12월~)'],
        ['전략폰 (정규)',       '~36행',      '△ 익스포트 기반', '~3행/월',   '일상 운영 (2024년 10월~)'],
        ['Galaxy S25 (가상)', '~1,086행 추정', '⚠ 가상 (TQ 사용)', '~362행/월', '주력 기종 2025 (Feb–Apr)'],
        ['iPhone 16e (가상)', '~39행 추정',  '⚠ 가상 (TQ 사용)', '~13행/월',  '주력 기종 2025 (Apr–Jun)'],
        ['S25 Edge (가상)',    '~450행 추정', '⚠ 가상 (TQ 사용)', '~150행/월', '주력 기종 2025 (Jun–Aug)'],
        ['Pixel 9a (가상)',    '~240행 추정', '⚠ 가상 (TQ 사용)', '~80행/월',  '주력 기종 2025 (Jul–Sep)'],
        ['Galaxy Z7 (가상)',   '~540행 추정', '⚠ 가상 (TQ 사용)', '~180행/월', '주력 기종 2025 (Aug–Oct)'],
        ['iPhone 17 (가상)',   '~900행 추정', '⚠ 가상 (TQ 사용)', '~300행/월', '주력 기종 2025 (Oct–Dec)'],
        ['Pixel 10 (가상)',    '~240행 추정', '⚠ 가상 (TQ 사용)', '~80행/월',  '주력 기종 2025-26 (Nov–Jan)'],
        ['Galaxy Z8 (예정)',   '~540행 추정', '◎ 미출시 예상',   '~180행/월', '주력 기종 2026 (Jul–Sep)'],
        ['iPhone 18 (예정)',   '~1,050행 추정','◎ 미출시 예상',  '~350행/월', '주력 기종 2026 (Sep–Dec)'],
    ])

doc.add_paragraph()
ap(doc, '※ ⚠ 주의: GDrive MCP는 시트당 최대 112행만 익스포트하므로 '
   '대용량 시트의 행 수는 과소 표시됩니다. 정확한 수치 확인 시 실제 스프레드시트 직접 접근 필요.',
   sz=9, col=RED, sa=4)

# ══ §2 토큰 계산 방법론 ════════════════════════════════════════════════════════
heading(doc, '2. 토큰 계산 방법론 (DR() 호출 1회 기준)')
ap(doc,
   'Defect 시트 (Galaxy S26 스프레드시트 내) 기준. '
   '대분류에 따라 EnrichedList 크기가 달라지며, 이 부분이 전체 토큰의 99% 이상을 차지합니다.',
   sz=10, sa=4)

table(doc,
    ['대분류', '항목 수', '글자 수', '토큰 수 (÷3)', '템플릿+리뷰', '입력 토큰 합계'],
    [
        ['휴대폰케이스',   '156개', '~27,316자', '~9,105 tok', '+190 tok', '~9,295 tok'],
        ['휴대폰보호필름', '110개', '~16,954자', '~5,651 tok', '+190 tok', '~5,841 tok'],
        ['가중 평균 (케이스 80% + 보호필름 20%)', '—', '—', '—', '—', f'~{IN_TOK:,} tok'],
    ], bold_last=True)

doc.add_paragraph()
table(doc,
    ['구성 요소', '내용', '토큰 수', '비고'],
    [
        ['입력 (Input)', f'EnrichedList + 템플릿 + 리뷰 본문', f'~{IN_TOK:,} tok', 'EnrichedList이 전체의 ~98%'],
        ['출력 (Output)', '분류 라벨명만 (예: 황변, 외관파손)', f'~{OUT_TOK} tok', 'maxOutputTokens: 20 설정'],
        ['합계 / 호출', '—', f'~{IN_TOK+OUT_TOK:,} tok/회', '출력은 전체 비용의 0.01% 미만'],
    ], bold_last=True)

doc.add_paragraph()
bullet(doc, '6시간 캐시 (CacheService.getScriptCache): 동일 텍스트의 첫 평가 시 1회만 Gemini 호출, 재계산 무비용')
bullet(doc, f'키워드 패스트패스 (~10% 우회): "heavy/bulky / yellow / button / attach / scratch" → Gemini 미호출, 0 토큰')
bullet(doc, '폴백 모델 (~5%): 1차 실패 시 2차 모델 호출 → 해당 행 토큰 2배 집계 (전체 약 2% 추가)')
bullet(doc, 'thinkingConfig: { thinkingBudget: 0 } — 추론 토큰 없음, temperature: 0')

# ══ §3 요금 및 호출당 비용 ════════════════════════════════════════════════════
heading(doc, '3. Gemini API 요금 및 호출당 비용')
ap(doc, '본 보고서의 모든 비용은 gemini-3.5-flash 요금 기준으로 산출합니다.', sz=10, sa=4)

cpr = CPC * 0.90  # 키워드 우회 10% 제외
table(doc,
    ['모델', '구분', '$/백만 입력', '$/백만 출력', '호출당 비용', '리뷰당 비용 (90%)'],
    [
        ['gemini-3.5-flash',       '비용 산출 기준', '$1.50', '$9.00', f'${CPC:.6f}', f'${cpr:.6f}'],
        ['gemini-3-flash-preview', '구 폴백 (참고)', '$0.25', '$1.50',
         f'${(IN_TOK*0.25+OUT_TOK*1.50)/1e6:.6f}', '—'],
        ['gemini-3.1-flash-lite',  '현재 실 운영 모델 (참고)', '$0.25', '$1.50',
         f'${(IN_TOK*0.25+OUT_TOK*1.50)/1e6:.6f}', '—'],
        ['gemini-2.5-flash-lite',  '현재 폴백 (참고)', '$0.10', '$0.40',
         f'${(IN_TOK*0.10+OUT_TOK*0.40)/1e6:.6f}', '—'],
    ])
doc.add_paragraph()
ap(doc,
   f'gemini-3.5-flash 기준: 호출 1회 = ${CPC:.6f}  (입력 {IN_TOK:,}토큰 × $1.50/백만 + 출력 {OUT_TOK}토큰 × $9.00/백만)\n'
   f'현재 실제 모델(gemini-3.1-flash-lite) 대비 6배 비싼 기준으로 보수적 상한선 산정.',
   sz=10, col=RED, bold=True, sa=6)

# ══ §4 2025년 월별 타임라인 ════════════════════════════════════════════════════
heading(doc, '4. 월별 타임라인 — 2025년 (가상 추정)')
ap(doc,
   '2025년 전 시리즈는 인입사유(TQ) 사용, DR() 미배포. '
   '각 기종의 월간 속도는 Galaxy S26(확인된 362/월), iPhone 17e(확인된 13/월)를 기준으로 '
   '기종 규모와 판매량에 비례하여 추정. gemini-3.5-flash 요금 적용.',
   sz=10, sa=4, col=GRAY)

h25 = ['월', 'Galaxy S25', 'iPhone 16e', 'S25 Edge', 'Pixel 9a', 'Galaxy Z7', 'iPhone 17', 'Pixel 10',
        '합계', '입력 토큰 (K)', '예상 비용']
rows_25, tc25, cost25 = [], 0, 0.0
for r in y2025:
    s = list(r[1:])
    tot = sum(s)
    cost = tot * CPC
    tc25 += tot; cost25 += cost
    rows_25.append([r[0]] + [str(v) if v else '—' for v in s] +
                   [str(tot) if tot else '—',
                    f"{tot*IN_TOK/1000:.0f}K" if tot else '—',
                    f"${cost:.3f}" if tot else '—'])
rows_25.append(['2025년 합계 (가상 추정)',
                '~1,086','~39','~450','~240','~540','~900','~240',
                str(tc25), f"{tc25*IN_TOK/1000:.0f}K", f"${cost25:.2f}"])
table(doc, h25, rows_25, bold_last=True)
doc.add_paragraph()
bullet(doc, 'Galaxy S25/S26 동일 플래그십 라인 → S25 월간 속도 S26 확인치와 동일하게 적용 (362행/월)')
bullet(doc, 'iPhone 16e/17e 동일 보급형 라인 → 16e 속도 17e 확인치와 동일하게 적용 (13행/월)')
bullet(doc, 'S25 Edge, Z7, Pixel 9a/10, iPhone 17 → 기종 포지셔닝 기반 추정 (±30% 오차 가능)')
bullet(doc, '정규 시트 (SDA 등) 2025년 수치 별도 집계 → §5 2026년 표에 포함')

# ══ §5 2026년 월별 타임라인 ════════════════════════════════════════════════════
heading(doc, '5. 월별 타임라인 — 2026년 (실제 + 예상)')
ap(doc,
   '★ Galaxy S26(1,267행), 유지훈P(1,635행): 실제 스프레드시트에서 확인된 수치. '
   'iPhone 17e(40행), Pixel 10a(42행): GDrive 익스포트 기반. '
   '정규 시트: 약 60행/월 합산 (SDA 31 + Auto_Acc 16 + Power_Acc 10 + 전략폰 3).',
   sz=10, sa=4)

h26 = ['월','Galaxy S26★','유지훈P★','iPh 17e','Pixel 10a','Galaxy Z8†','iPh 18†','정규 시트',
        '합계','입력 토큰 (K)','총 토큰 (K)','예상 비용']
rows_26, tc26, cost26 = [], 0, 0.0
series_totals = {'S26':0,'YJH':0,'17e':0,'10a':0,'Z8':0,'18':0,'REG':0}
for r in y2026:
    s26,yjh,i17e,p10a,z8,i18,reg = r[1],r[2],r[3],r[4],r[5],r[6],r[7]
    tot=s26+yjh+i17e+p10a+z8+i18+reg; cost=tot*CPC
    tc26+=tot; cost26+=cost
    series_totals['S26']+=s26; series_totals['YJH']+=yjh; series_totals['17e']+=i17e
    series_totals['10a']+=p10a; series_totals['Z8']+=z8; series_totals['18']+=i18; series_totals['REG']+=reg
    def f(v): return str(v) if v else '—'
    rows_26.append([r[0], f(s26), f(yjh), f(i17e), f(p10a), f(z8), f(i18), f(reg),
                    str(tot), f"{tot*IN_TOK/1000:.0f}K",
                    f"{tot*(IN_TOK+OUT_TOK)/1000:.0f}K", f"${cost:.3f}"])
rows_26.append(['2026년 합계',
                f"~{series_totals['S26']:,}", f"~{series_totals['YJH']:,}",
                f"~{series_totals['17e']}", f"~{series_totals['10a']}",
                f"~{series_totals['Z8']}", f"~{series_totals['18']:,}",
                f"~{series_totals['REG']:,}",
                f"{tc26:,}", f"{tc26*IN_TOK/1000:.0f}K",
                f"{tc26*(IN_TOK+OUT_TOK)/1000:.0f}K", f"${cost26:.2f}"])
table(doc, h26, rows_26, bold_last=True)
doc.add_paragraph()
bullet(doc, '★ Galaxy S26: 2026년 3~6월 (4개월), 실확인 1,267행 기준 약 362행/월')
bullet(doc, '★ 유지훈P: 2026년 전체 연중 운영, 실확인 1,635행 기준 약 297행/월')
bullet(doc, 'iPh 17e: GDrive 익스포트 기반 40행 (3~6월), 약 13행/월. 보급형 기종 특성상 적은 수')
bullet(doc, 'Pixel 10a: GDrive 익스포트 기반 42행 (3~5월), 약 17행/월')
bullet(doc, '† Galaxy Z8 출시 예상 2026년 7월, 모니터링 7~9월, 약 180행/월 (Z7 유사 규모)')
bullet(doc, '† iPhone 18 출시 예상 2026년 9월, 모니터링 9월 중반~12월 중반, 약 350행/월 (S26 유사 규모)')
bullet(doc, '정규 시트 (SDA/Auto_Acc/Power_Acc/전략폰): GDrive 익스포트 날짜 범위 기반 속도 산출')

# ══ §6 연도별 비용 요약 ════════════════════════════════════════════════════════
heading(doc, '6. 연도별 비용 요약 (gemini-3.5-flash 기준)')
grand = cost25 + cost26
table(doc,
    ['구분', 'DR() 호출 수', '입력 토큰', '총 토큰', '예상 비용 (USD)', '비고'],
    [
        ['2025년 전체 (가상 추정)',
         f"{tc25:,}", f"{tc25*IN_TOK:,}", f"{tc25*(IN_TOK+OUT_TOK):,}", f"${cost25:.2f}",
         'TQ 사용 기간 — 가상 추정'],
        ['2026년 전체 (실제+예상)',
         f"{tc26:,}", f"{tc26*IN_TOK:,}", f"{tc26*(IN_TOK+OUT_TOK):,}", f"${cost26:.2f}",
         '실확인 2종 + 예상 포함'],
        ['2025~2026 총합계',
         f"{tc25+tc26:,}", f"{(tc25+tc26)*IN_TOK:,}",
         f"{(tc25+tc26)*(IN_TOK+OUT_TOK):,}", f"${grand:.2f}", ''],
    ], bold_last=True)
doc.add_paragraph()
ap(doc, f'gemini-3.5-flash 기준 총 예상 비용: USD ${grand:.2f}  |  총 토큰: {(tc25+tc26)*(IN_TOK+OUT_TOK):,}개',
   bold=True, sz=13, col=DARK, sa=4, align=WD_ALIGN_PARAGRAPH.CENTER)
ap(doc, f'참고 — 현재 실제 운영 모델(gemini-3.1-flash-lite, $0.25/백만) 기준 시 약 ${grand/6:.2f} 예상 (83% 절감)',
   sz=10, col=GRAY, sa=6, align=WD_ALIGN_PARAGRAPH.CENTER)

# ══ §7 시리즈별 누적 현황 ══════════════════════════════════════════════════════
heading(doc, '7. 시리즈 / 시트별 누적 DR() 호출 현황')
def sr(name, typ, period, rows, note=''):
    return [name, typ, period, f"{rows:,}", f"{int(rows*0.9):,}", f"{rows*IN_TOK:,}", f"${rows*CPC:.3f}", note]

confirmed_s26  = 1267
confirmed_yjh  = 1635
confirmed_17e  = 40
confirmed_10a  = 42

series = [
    sr('Galaxy S25 (가상)',     '주력 기종 2025', '2025년 2~4월 (~3개월)', tc25 * 362 // sum([362,13,150,80,180,300,80]),  '실측 S26(362/월) 기준'),
    sr('iPhone 16e (가상)',     '주력 기종 2025', '2025년 4~6월 (~3개월)', 39,   '실측 17e(13/월) 기준'),
    sr('S25 Edge (가상)',       '주력 기종 2025', '2025년 6~8월 (~3개월)', 450,  '추정 150/월'),
    sr('Pixel 9a (가상)',       '주력 기종 2025', '2025년 7~9월 (~3개월)', 240,  '추정 80/월'),
    sr('Galaxy Z7 (가상)',      '주력 기종 2025', '2025년 8~10월 (~3개월)',540,  '추정 180/월'),
    sr('iPhone 17 (가상)',      '주력 기종 2025', '2025년 10~12월 (~3개월)',900, '추정 300/월'),
    sr('Pixel 10 (가상)',       '주력 기종 25-26','2025년 11월~2026년 1월', 240, '추정 80/월'),
    sr('Galaxy S26 ★',         '주력 기종 2026', '2026년 3~6월 (확인)',    confirmed_s26, '★ 실측 1,267행'),
    sr('iPhone 17e',            '주력 기종 2026', '2026년 3~6월 (익스포트기반)', confirmed_17e, '~40행'),
    sr('Pixel 10a',             '주력 기종 2026', '2026년 3~5월 (익스포트기반)', confirmed_10a, '~42행'),
    sr('유지훈P ★',             '일상 운영 2026', '2026년 전체 (확인)',     confirmed_yjh, '★ 실측 1,635행'),
    sr('Galaxy Z8†',            '주력 기종 예정', '2026년 7~9월',           series_totals['Z8'], '예상 180/월'),
    sr('iPhone 18†',            '주력 기종 예정', '2026년 9~12월',          series_totals['18'], '예상 350/월'),
    sr('SDA (정규)',             '일상 운영',      '2026년 전체',            series_totals['REG']*31//60, '속도: ~31/월'),
    sr('Auto_Acc (정규)',        '일상 운영',      '2026년 전체',            series_totals['REG']*16//60, '속도: ~16/월'),
    sr('Power_Acc (정규)',       '일상 운영',      '2026년 전체',            series_totals['REG']*10//60, '속도: ~10/월'),
    sr('전략폰 (정규)',           '일상 운영',      '2026년 전체',            series_totals['REG']*3//60, '속도: ~3/월'),
]
all_r   = sum(int(r[3].replace(',','')) for r in series)
all_c   = sum(int(r[4].replace(',','')) for r in series)
all_t   = sum(int(r[5].replace(',','')) for r in series)
all_co  = sum(float(r[6].replace('$','')) for r in series)
series.append(['합계 (2025~2026)', '—', '—', f"{all_r:,}", f"{all_c:,}", f"{all_t:,}", f"${all_co:.2f}", ''])
table(doc, ['시리즈/시트','유형','모니터링 기간','전체 행 수','DR() 호출 (90%기준)','입력 토큰','예상 비용','비고'],
      series, bold_last=True)

# ══ §8 정규 시트 분석 ═════════════════════════════════════════════════════════
heading(doc, '8. 정규 시트 현황 — GDrive 익스포트 기반 속도 산출')
ap(doc,
   '정규 시트(SDA, Auto_Acc, Power_Acc, 전략폰)는 현재 DR() 미사용. '
   'GDrive MCP 익스포트에서 확인된 날짜 범위와 행 수로 월간 속도를 역산했습니다.',
   sz=10, sa=4)
table(doc,
    ['시트', '국가', '익스포트 날짜 범위', '익스포트 행 수', '산출 속도', '추정 누적 행 수 (2026년 6월 기준)'],
    [
        ['SDA',       'FR,ES,JP,UK,DE,IT (6개국)', '2025-02-07 → 2025-06-07', '124행', '~31행/월',
         '~500행 (2025년 2월 시작 기준 16개월)'],
        ['Auto_Acc',  'FR,ES,UK,DE,IT (5개국)',    '2024-01-03 → 2024-11-02', '155행', '~16행/월',
         '~450행 (2024년 1월 시작 기준 30개월)'],
        ['Power_Acc', 'IN (1개국)',                 '2025-12-02 → 2026-06-09', '73행',  '~10행/월',
         '~73행 (2025년 12월 시작, 최신 데이터 확인)'],
        ['전략폰',    'IN (1개국)',                  '2024-10-14 → 2026-05-11', '36행',  '~2행/월',
         '~36행 (희소 유입, 거의 완전 확인)'],
        ['합계', '—', '—', '—', '~60행/월', '~1,060행 (추정 누적)'],
    ], bold_last=True)
doc.add_paragraph()
bullet(doc, '⚠ SDA, Auto_Acc는 익스포트가 최초 행(가장 오래된 데이터)부터 잘리므로 실제 총 행 수는 더 많을 수 있음', col=RED)
bullet(doc, 'Power_Acc, 전략폰은 최신 날짜까지 데이터가 보이므로 익스포트가 완전하거나 거의 완전한 것으로 추정')
bullet(doc, 'DR()가 배포될 경우 기존 누적 행(추정 ~1,060행)에 대한 일괄 처리 비용 추가 발생 → 약 $' + f"{1060*CPC:.2f}")

# ══ §9 주요 가정 및 유의사항 ═══════════════════════════════════════════════════
heading(doc, '9. 주요 가정 및 유의사항')
for t,b in [
    ('비용 산출 기준', f'gemini-3.5-flash ($1.50/백만 입력, $9.00/백만 출력) 기준으로 보수적 상한선 산정. '
     f'현재 실 운영 모델(gemini-3.1-flash-lite)로는 약 $1.{round(grand/6,2):.2f} 예상, 약 83% 절감 가능.'),
    ('실측 행 수',     'Galaxy S26 1-3점: 1,267행, 유지훈P 1-3점: 1,635행은 사용자가 실제 스프레드시트에서 확인한 수치. '
     'GDrive MCP는 시트당 최대 112행을 내보내므로 나머지 시트의 행 수는 과소 산정될 수 있음.'),
    ('월간 속도 기준', 'S26 362행/월, 유지훈P 297행/월은 실확인치로 산출 (총 행 수 ÷ 모니터링 기간). '
     '2025년 TQ 시리즈 속도는 동급 기종(S26, 17e) 실측치를 기준으로 비례 추정.'),
    ('토큰 계산',      f'한국어 혼합: 3자/토큰. 영어 템플릿: 4자/토큰. 가중 평균 입력 {IN_TOK:,}토큰/회. '
     '실제 토큰은 GAS 로그에서 확인: [DR] tokens — input: X, output: Y'),
    ('키워드 우회',    '약 10%의 리뷰가 영어 키워드(heavy/bulky/yellow/button/attach/scratch)로 우회 → Gemini 0토큰. '
     '리뷰당 비용 = 호출당 비용 × 0.9.'),
    ('6시간 캐시',     '동일 리뷰 텍스트는 첫 평가 시 1회만 Gemini 호출. 재계산/시트 리로드 시 캐시 적중 = 0비용. '
     'DR_CACHE_VERSION(현재 v22) 변경 시 전체 캐시 초기화.'),
    ('Galaxy Z8/iPhone 18', 'Galaxy Z8: 2026년 7월 출시 예상, 3개월 모니터링, 약 180행/월 (Z7과 유사 규모). '
     'iPhone 18: 2026년 9월 출시 예상, 3개월 모니터링, 약 350행/월 (S26과 유사 규모). ±30% 오차 가능.'),
    ('주말 미운영',    'Master.gs dailyJob()은 평일만 실행. 월간 추정 기준: 22 평일/월.'),
    ('오차 범위',      '실제 비용은 리뷰 유입 속도, Defect 시트 항목 수 변경, 출시 일정에 따라 ±30% 변동 가능.'),
]:
    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(4)
    r1=p.add_run(f'{t}: '); r1.bold=True; r1.font.size=Pt(10)
    r2=p.add_run(b); r2.font.size=Pt(10)

# ══ §10 총괄 요약 ══════════════════════════════════════════════════════════════
heading(doc, '10. 총괄 요약')
table(doc,
    ['구분','DR() 호출 수','입력 토큰','총 토큰','예상 비용 (USD)','비고'],
    [
        ['2025년 (가상 추정)',   f"{tc25:,}", f"{tc25*IN_TOK:,}",
         f"{tc25*(IN_TOK+OUT_TOK):,}", f"${cost25:.2f}", '3.5-flash 기준, TQ 기간 가상'],
        ['2026년 (실제+예상)',   f"{tc26:,}", f"{tc26*IN_TOK:,}",
         f"{tc26*(IN_TOK+OUT_TOK):,}", f"${cost26:.2f}", '실측 2종 + 예상 포함'],
        ['2025~2026 총합계',     f"{tc25+tc26:,}", f"{(tc25+tc26)*IN_TOK:,}",
         f"{(tc25+tc26)*(IN_TOK+OUT_TOK):,}", f"${grand:.2f}", ''],
    ], bold_last=True)

doc.add_paragraph()
ap(doc, f'gemini-3.5-flash 기준 총 예상 Gemini API 비용: USD ${grand:.2f}',
   bold=True, sz=14, col=DARK, sa=2, align=WD_ALIGN_PARAGRAPH.CENTER)
ap(doc, f'총 토큰: {(tc25+tc26)*(IN_TOK+OUT_TOK):,}개  |  DR() 총 호출: {tc25+tc26:,}건',
   sz=11, col=GRAY, sa=4, align=WD_ALIGN_PARAGRAPH.CENTER)

ap(doc,
   f'• 호출 1회당: ${CPC:.6f}  (입력 {IN_TOK:,}tok × $1.50/백만 + 출력 {OUT_TOK}tok × $9.00/백만)\n'
   f'• 리뷰 1건당: ${cpr:.6f}  (키워드 우회 10% 제외)\n'
   f'• 정규 시트 기준 월간 비용: ${REG_PM*CPC:.4f}/월 (60건/월 기준)\n'
   f'• 유지훈P + 정규 시트 상시 운영 월간 비용: ${(YJH_PM+REG_PM)*CPC:.4f}/월\n'
   f'• 참고 — 현재 실제 모델(gemini-3.1-flash-lite) 기준 시 약 ${grand/6:.2f} (83% 절감)',
   sz=10, sa=6)

ap(doc,
   '※ Google AI Studio pay-as-you-go 요금 기준. 프리 티어 및 약정 할인 미적용. '
   '실제 청구 금액 ±30% 내외 변동 가능.',
   sz=9, col=GRAY)

doc.add_paragraph()
fp=doc.add_paragraph(); fp.alignment=WD_ALIGN_PARAGRAPH.CENTER
fr=fp.add_run('Generated by Claude Code (claude-sonnet-4-6) | Spigen GCX 자동화팀 | 2026년 6월 15일')
fr.font.size=Pt(8); fr.font.color.rgb=rgb("999999"); fr.italic=True

doc.save(OUTPUT)
print(f"저장 완료 → {OUTPUT}")
print(f"\n핵심 수치:")
print(f"  호출당 비용 (3.5-flash): ${CPC:.6f}")
print(f"  2025년 (가상):            {tc25:,}건, ${cost25:.2f}")
print(f"  2026년 (실제+예상):       {tc26:,}건, ${cost26:.2f}")
print(f"  총합계:                   {tc25+tc26:,}건, ${grand:.2f}")
print(f"  총 토큰:                  {(tc25+tc26)*(IN_TOK+OUT_TOK):,}")
