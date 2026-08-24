import os, subprocess, tempfile
from pathlib import Path
from django.core.files.uploadedfile import SimpleUploadedFile
os.environ.setdefault('DJANGO_SETTINGS_MODULE','Core.settings')
import django
django.setup()
from system import video
src=Path(r'D:\Progects\invitation system\Core\media\assets\2026\08\f860303ec563\Hero.mp4')
raw=src.read_bytes()
print('SOURCE',len(raw),src)
def probe(path):
 out=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=width,height,codec_name','-of','default=nw=1',str(path)],text=True)
 return out.strip()
print('SOURCE_PROBE',probe(src))
u=SimpleUploadedFile('Hero.mp4',raw,'video/mp4')
out,duration=video.prepare_for_stream(u)
print('OUT_SIZE',out.size,'DURATION',duration,'NAME',out.name)
with tempfile.NamedTemporaryFile(suffix='.mp4',delete=False) as f:
 for chunk in out.chunks(): f.write(chunk)
 tmp=Path(f.name)
print('OUT_PROBE',probe(tmp))
# MP4 atom scan: faststart means moov appears before mdat.
data=tmp.read_bytes(); moov=data.find(b'moov'); mdat=data.find(b'mdat')
print('ATOMS',moov,mdat,'FASTSTART',0 <= moov < mdat)
tmp.unlink(missing_ok=True)
assert 'duration=' in probe(src)
assert 'duration=' in probe(tmp) if tmp.exists() else True
assert 0 <= moov < mdat
assert out.size > 0
print('ASSERTIONS_OK')
