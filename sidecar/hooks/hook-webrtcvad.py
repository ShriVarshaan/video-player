# The wheel ships as "webrtcvad-wheels", not "webrtcvad" (the contrib hook
# looks for the latter and fails).
from PyInstaller.utils.hooks import copy_metadata

datas = copy_metadata("webrtcvad-wheels")
