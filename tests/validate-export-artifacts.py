from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pdfplumber
from PIL import Image


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate_docx(path: Path) -> dict:
    require(path.is_file() and path.stat().st_size > 5000, "DOCX output is missing or empty")
    with zipfile.ZipFile(path) as package:
        names = set(package.namelist())
        required = {
            "[Content_Types].xml",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/header1.xml",
            "word/footer1.xml",
        }
        require(required <= names, f"DOCX package parts missing: {sorted(required - names)}")
        require(any(name.startswith("word/media/") for name in names), "DOCX contains no embedded media")
        document = package.read("word/document.xml").decode("utf-8")
        styles = package.read("word/styles.xml").decode("utf-8")
        numbering = package.read("word/numbering.xml").decode("utf-8")
        footer = package.read("word/footer1.xml").decode("utf-8")
        require("今天沿着河边" in document and "普通的一年" in document, "DOCX Chinese archive text is missing")
        require("好友 1" in document and "阿程" not in document, "DOCX anonymization is incomplete")
        require("w:type=\"page\"" in footer or "PAGE" in footer, "DOCX page number field is missing")
        require("ArchiveBody" in styles and "Microsoft YaHei" in styles and "SimSun" in styles, "DOCX Chinese styles are incomplete")
        require("w:abstractNum" in numbering, "DOCX real list numbering is missing")
        root = ET.fromstring(package.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        section = root.find(".//w:sectPr", ns)
        require(section is not None, "DOCX section properties are missing")
        page_size = section.find("w:pgSz", ns)
        margins = section.find("w:pgMar", ns)
        require(page_size is not None and margins is not None, "DOCX page geometry is missing")
        return {"parts": len(names), "media": len([name for name in names if name.startswith("word/media/")])}


def validate_pdf(path: Path, pngs: list[Path]) -> dict:
    require(path.is_file() and path.stat().st_size > 5000, "PDF output is missing or empty")
    with pdfplumber.open(path) as pdf:
        require(2 <= len(pdf.pages) <= 8, f"Unexpected PDF page count: {len(pdf.pages)}")
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        require("林屿的空间档案" in text and "今天沿着河边" in text, "PDF Chinese text is missing")
        require("好友 1" in text and "阿程" not in text, "PDF anonymization is incomplete")
        for index, page in enumerate(pdf.pages, start=1):
            require(abs(page.width - 595.28) < 3 and abs(page.height - 841.89) < 3, f"PDF page {index} is not A4")
            for char in page.chars:
                require(-0.5 <= char["x0"] <= page.width + 0.5, f"PDF page {index} has text outside horizontal bounds")
                require(-0.5 <= char["top"] <= page.height + 0.5, f"PDF page {index} has text outside vertical bounds")
    require(len(pngs) == len(pdf.pages), "Rendered PDF page count does not match")
    for png in pngs:
        with Image.open(png) as image:
            require(image.width > 700 and image.height > 1000, f"Rendered page is unexpectedly small: {png.name}")
            rgb = image.convert("RGB")
            border_samples = []
            for x in range(0, rgb.width, max(1, rgb.width // 100)):
                border_samples.extend([rgb.getpixel((x, 0)), rgb.getpixel((x, rgb.height - 1))])
            for y in range(0, rgb.height, max(1, rgb.height // 100)):
                border_samples.extend([rgb.getpixel((0, y)), rgb.getpixel((rgb.width - 1, y))])
            require(all(sum(pixel) > 690 for pixel in border_samples), f"Rendered content touches page edge: {png.name}")
    return {"pages": len(pngs), "pageSize": [round(pdf.pages[0].width, 2), round(pdf.pages[0].height, 2)]}


def validate_html(path: Path) -> dict:
    html = path.read_text(encoding="utf-8")
    require("Content-Security-Policy" in html and "default-src 'none'" in html, "Offline HTML CSP is missing")
    require("data:image/png;base64," in html, "Offline HTML media is not embedded")
    require("<script" not in html.lower() and "javascript:" not in html.lower(), "Offline HTML contains an active script surface")
    require("好友 1" in html and "阿程" not in html, "HTML anonymization is incomplete")
    return {"bytes": path.stat().st_size}


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    report = {
        "html": validate_html(root / "archive-sample.html"),
        "docx": validate_docx(root / "archive-sample.docx"),
        "pdf": validate_pdf(root / "archive-sample.pdf", sorted(root.glob("pdf-page-*.png"))),
        "wordRenderedDocx": validate_pdf(root / "archive-sample-word.pdf", sorted(root.glob("word-page-*.png"))),
    }
    print(report)


if __name__ == "__main__":
    main()
