#!/usr/bin/env python3
"""
Draw the hop molecules for the Science page: a 2D skeletal formula (SVG) and a
3D conformer (MOL block, for the spin-it viewer) for each, from SMILES.

    python tools/molecules.py      # writes site/assets/molecules/*.svg and molecules.json

Needs RDKit (pip install rdkit). The structures are the standard PubChem
ones; each formula is checked below so a typo can't slip through.
"""
import json
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem, rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Chem.rdMolDescriptors import CalcMolFormula

OUT = Path(__file__).resolve().parents[1] / "site" / "assets" / "molecules"
MOLECULES = {
    "humulone": ("CC(C)CC(=O)C1=C(O)C(O)(CC=C(C)C)C(=O)C(CC=C(C)C)=C1O", "C21H30O5"),
    "cohumulone": ("CC(C)C(=O)C1=C(O)C(O)(CC=C(C)C)C(=O)C(CC=C(C)C)=C1O", "C20H28O5"),
    "isohumulone": ("O=C1C(C(=O)CC(C)C)=C(O)C(O)(C(=O)CC=C(C)C)C1CC=C(C)C", "C21H30O5"),
    "lupulone": ("CC(C)CC(=O)C1=C(O)C(CC=C(C)C)(CC=C(C)C)C(=O)C(CC=C(C)C)=C1O", "C26H38O4"),
    "myrcene": ("CC(C)=CCCC(=C)C=C", "C10H16"),
    "humulene": ("CC1=CCC(C)(C)C=CCC(C)=CCC1", "C15H24"),
    "caryophyllene": ("CC1=CCCC(=C)C2CC(C)(C)C2CC1", "C15H24"),
    "farnesene": ("CC(C)=CCCC(C)=CCCC(=C)C=C", "C15H24"),
    "linalool": ("CC(C)=CCCC(C)(O)C=C", "C10H18O"),
    "geraniol": ("CC(C)=CCCC(C)=CCO", "C10H18O"),
    "4mmp": ("CC(=O)CC(C)(C)S", "C6H12OS"),
    "mbt": ("CC(C)=CCS", "C5H10S"),
}


def svg(mol):
    rdDepictor.SetPreferCoordGen(False)  # the classic depictor draws the big rings (humulene) cleaner
    rdDepictor.Compute2DCoords(mol)
    d = rdMolDraw2D.MolDraw2DSVG(360, 240)
    o = d.drawOptions()
    o.clearBackground = False
    o.bondLineWidth = 2
    o.padding = 0.08
    o.updateAtomPalette({8: (0.72, 0.26, 0.2), 16: (0.78, 0.57, 0.16)})
    d.DrawMolecule(mol)
    d.FinishDrawing()
    text = d.GetDrawingText()
    # Carbon skeleton in the page's ink colour, so it works in dark mode too.
    text = text.replace("#000000", "currentColor")
    return text[text.index("<svg"):]


def conformer(mol):
    h = Chem.AddHs(mol)
    AllChem.EmbedMolecule(h, randomSeed=7)
    AllChem.MMFFOptimizeMolecule(h)
    return Chem.MolToMolBlock(h)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    three = {}
    for name, (smiles, formula) in MOLECULES.items():
        mol = Chem.MolFromSmiles(smiles)
        assert CalcMolFormula(mol) == formula, (name, CalcMolFormula(mol), formula)
        (OUT / f"{name}.svg").write_text(svg(Chem.Mol(mol)), encoding="utf-8")
        three[name] = conformer(mol)
        print(f"{name:14} {formula}")
    (OUT / "molecules.json").write_text(json.dumps(three), encoding="utf-8")


if __name__ == "__main__":
    main()
