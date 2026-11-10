"""
archive_pensiero.py — aggiunge il pensiero corrente (pensiero.json) all'archivio pensieri.json.
Eseguito da GitHub Actions ogni volta che pensiero.json viene modificato.
Se esiste già un pensiero con la stessa data lo sostituisce (correzione), altrimenti lo aggiunge in cima.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cur = json.load(open(os.path.join(ROOT, "pensiero.json"), encoding="utf-8"))
path = os.path.join(ROOT, "pensieri.json")
arch = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
lista = arch.get("pensieri", [])

testo, data = str(cur.get("testo", "")).strip(), str(cur.get("data", "")).strip()
if testo and data:
    lista = [p for p in lista if p.get("data") != data and str(p.get("testo", "")).strip() != testo]
    lista.append({"data": data, "testo": testo})
    lista.sort(key=lambda p: p.get("data", ""), reverse=True)
    arch["_comment"] = "Archivio dei pensieri della settimana: si aggiorna da solo quando cambia pensiero.json. Non serve modificarlo a mano."
    arch["pensieri"] = lista
    json.dump(arch, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(path, "a", encoding="utf-8").write("\n")
    print(f"Archivio: {len(lista)} pensieri, ultimo del {lista[0]['data']}")
else:
    print("pensiero.json senza testo o data: archivio invariato")
