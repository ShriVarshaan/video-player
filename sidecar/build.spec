# PyInstaller spec for the auto sync sidecar (onedir → sidecar/dist/vp-sync/).
# Build with: npm run build-sidecar
# -*- mode: python -*-
import os

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

HERE = os.path.dirname(os.path.abspath(SPEC))

a = Analysis(
    [os.path.join(HERE, "vp_sync", "entry.py")],
    pathex=[HERE],
    datas=collect_data_files("ffsubsync") + copy_metadata("ffsubsync"),
    hiddenimports=["webrtcvad"],
    hookspath=[os.path.join(HERE, "hooks")],
    # Speech recognition, GUI and auditok (GPLv3; only for --vad auditok) paths of
    # ffsubsync are never used: we always pass --vad webrtc.
    excludes=["torch", "faster_whisper", "auditok", "gooey", "wx", "tkinter", "matplotlib", "IPython", "PIL", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="vp-sync",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="vp-sync", upx=False)
