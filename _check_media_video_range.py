import os
from pathlib import Path
os.environ.setdefault('DJANGO_SETTINGS_MODULE','Core.settings')
import django
django.setup()
from django.conf import settings
from django.test import Client
root=Path(settings.MEDIA_ROOT)
video=next(root.joinpath('assets').rglob('*.mp4'))
rel=video.relative_to(root).as_posix()
r=Client().get('/media-video/'+rel,HTTP_RANGE='bytes=0-1023')
print('FILE',rel,video.stat().st_size)
body=b''.join(r.streaming_content)
print('STATUS',r.status_code,'LEN',len(body),'HEADERS',r.headers.get('Accept-Ranges'),r.headers.get('Content-Range'),r.headers.get('Content-Length'),r.headers.get('Content-Type'))
assert r.status_code==206
assert len(body)==1024
assert r.headers.get('Accept-Ranges')=='bytes'
assert r.headers.get('Content-Range','').startswith('bytes 0-1023/')
print('ASSERTIONS_OK')
