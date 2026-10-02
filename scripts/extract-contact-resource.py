#!/usr/bin/env python3
"""Local contact-resource extractor for CSV/XLSX/DOCX/PDF/DOC/TXT/MD."""
import csv,json,re,subprocess,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
EMAIL=re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",re.I)
GENERIC=re.compile(r"^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales|security|billing|helpdesk)$",re.I)
HR=re.compile(r"hr|human resources|recruit|recruitment|talent acquisition|talent management|people operations|people & culture|staffing|hiring",re.I)
def xml_text(data):
    root=ET.fromstring(data)
    return " ".join((x.text or "").strip() for x in root.iter() if x.text and (x.tag.endswith("}t") or x.tag=="t"))
def read_docx(path):
    with zipfile.ZipFile(path) as z: return xml_text(z.read("word/document.xml"))
def read_xlsx(path):
    with zipfile.ZipFile(path) as z:
        shared=[]
        if "xl/sharedStrings.xml" in z.namelist():
            root=ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared=["".join((x.text or "") for x in si.iter() if x.tag.endswith("}t")) for si in root]
        wb=ET.fromstring(z.read("xl/workbook.xml")); rels=ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap={r.attrib.get("Id"):r.attrib.get("Target") for r in rels}
        ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main","r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
        out=[]
        for sheet in wb.findall("m:sheets/m:sheet",ns):
            rid=sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"); target=relmap.get(rid,"")
            target="xl/"+target.lstrip("/") if not target.startswith("xl/") else target
            if target not in z.namelist(): continue
            root=ET.fromstring(z.read(target))
            for row in root.findall(".//m:sheetData/m:row",ns):
                cells=[]
                for c in row.findall("m:c",ns):
                    v=c.find("m:v",ns)
                    cells.append("" if v is None else (shared[int(v.text)] if c.attrib.get("t")=="s" else (v.text or "")))
                if any(cells): out.append(cells)
        return out
def run(cmd):
    try:
        p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=60)
        return p.stdout if p.returncode==0 else ""
    except Exception: return ""
def read_file(path):
    ext=path.suffix.lower()
    if ext==".docx": return read_docx(path)
    if ext in (".xlsx",".xlsm"): return "\n".join(" | ".join(r) for r in read_xlsx(path))
    if ext==".pdf":
        text=run(["pdftotext","-layout",str(path),"-"])
        if not text: raise RuntimeError("PDF extraction requires local pdftotext; scanned PDFs need OCR.")
        return text
    if ext==".doc":
        text=run(["antiword",str(path)]) or run(["catdoc",str(path)])
        if not text: raise RuntimeError("DOC extraction requires local antiword or catdoc.")
        return text
    return path.read_text(encoding="utf-8",errors="replace")
def contacts(path):
    if path.suffix.lower()==".csv":
        with path.open(encoding="utf-8",errors="replace",newline="") as f: rows=list(csv.DictReader(f))
        for r in rows:
            vals={str(k).lower().strip():str(v or "").strip() for k,v in r.items()}
            for email in EMAIL.findall(" ".join(vals.values())):
                if GENERIC.match(email.split("@")[0]): continue
                yield {"name":vals.get("name") or vals.get("person") or vals.get("contact") or "","email":email.lower(),"title":vals.get("title") or vals.get("role") or vals.get("designation") or "","company":vals.get("company") or vals.get("company name") or vals.get("employer") or "","source_page":vals.get("source_page") or vals.get("url") or vals.get("linkedin") or ""}
        return
    text=read_file(path)
    lines=[re.sub(r"\s+"," ",x).strip() for x in text.splitlines() if x.strip()]
    for i,line in enumerate(lines):
        for email in EMAIL.findall(line):
            if GENERIC.match(email.split("@")[0]): continue
            context=" ".join(lines[max(0,i-2):min(len(lines),i+3)])
            title=next((x[:200] for x in lines[max(0,i-3):min(len(lines),i+4)] if HR.search(x)),"")
            yield {"name":"","email":email.lower(),"title":title,"company":"","source_page":context[:1200]}
def main():
    if len(sys.argv)<2: raise SystemExit("usage: extract-contact-resource.py FILE...")
    for raw in sys.argv[1:]:
        p=Path(raw).expanduser().resolve()
        if not p.is_file(): raise SystemExit("missing file: "+str(p))
        for row in contacts(p):
            row["source_file"]=p.name
            print(json.dumps(row,ensure_ascii=False))
if __name__=="__main__": main()
