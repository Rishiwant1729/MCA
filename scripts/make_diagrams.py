#!/usr/bin/env python3
"""Build diagrams/*.tex (standalone TikZ) into diagrams/*.svg + .png and report/figures/*.pdf.
Needs pdflatex (with the tikz and standalone packages) and PyMuPDF (`pip install pymupdf` in .venv)."""
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
for tex in sorted((ROOT / "diagrams").glob("*.tex")):
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", f"-output-directory={tmp}", str(tex)],
                           capture_output=True, text=True)
        pdf = Path(tmp) / f"{tex.stem}.pdf"
        if r.returncode or not pdf.exists():
            sys.exit(f"pdflatex failed for {tex.name}:\n{r.stdout[-1500:]}")
        (ROOT / "report" / "figures").mkdir(parents=True, exist_ok=True)
        (ROOT / "report" / "figures" / f"{tex.stem}.pdf").write_bytes(pdf.read_bytes())
        page = pymupdf.open(pdf)[0]
        (ROOT / "diagrams" / f"{tex.stem}.svg").write_text(page.get_svg_image(text_as_path=True))
        page.get_pixmap(dpi=200).save(ROOT / "diagrams" / f"{tex.stem}.png")
    print(f"built diagrams/{tex.stem}.svg, .png and report/figures/{tex.stem}.pdf")
