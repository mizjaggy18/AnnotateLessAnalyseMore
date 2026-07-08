# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for AnnotateLessAnalyseMore
# Produces a single .exe that auto-opens the browser on launch.

block_cipher = None

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Bundle the UI assets into the exe; app.py reads them from sys._MEIPASS
        ('templates', 'templates'),
        ('static',    'static'),
    ],
    hiddenimports=[
        # Flask stack
        'flask', 'jinja2', 'jinja2.ext', 'jinja2.loaders',
        'werkzeug', 'werkzeug.serving', 'werkzeug.debug',
        'werkzeug.middleware.proxy_fix',
        'click', 'itsdangerous', 'markupsafe',
        # Image processing
        'cv2', 'PIL', 'PIL.Image', 'PIL.ImageDraw', 'PIL._imaging',
        'numpy',
        # stdlib
        'email.mime.text', 'email.mime.multipart',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Cut unused heavy packages to reduce exe size
        'matplotlib', 'scipy', 'pandas', 'tkinter', 'PyQt5', 'PyQt6',
        'IPython', 'notebook', 'pytest', 'setuptools',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,   # onefile: embed all binaries
    a.zipfiles,
    a.datas,
    [],
    name='AnnotateLessAnalyseMore',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    # console=True keeps a terminal window so users can see the URL and any errors.
    # Change to False for a fully silent background process (browser-only UI).
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
