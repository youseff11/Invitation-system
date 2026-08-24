import os, json
os.environ.setdefault('DJANGO_SETTINGS_MODULE','Core.settings')
import django
django.setup()
from system.models import Template, Invitation

def walk(v,path=''):
    if isinstance(v,str) and 'Swans2' in v:
        pos=v.find('Swans2')
        print('FOUND',path,repr(v[max(0,pos-250):pos+250]))
    elif isinstance(v,dict):
        for k,x in v.items(): walk(x,path+'/'+str(k))
    elif isinstance(v,list):
        for i,x in enumerate(v): walk(x,path+'/'+str(i))
for obj in list(Template.objects.filter(slug='the-sacred-gardencountdown-timer'))+list(Invitation.objects.all()):
    print('OBJ',type(obj).__name__,obj.pk,getattr(obj,'slug',''))
    walk(obj.document)
