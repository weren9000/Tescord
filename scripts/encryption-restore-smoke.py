"""Restore only the disposable local encryption fixture. Run from repository root."""
import os,sys,json,subprocess,tarfile,io,hashlib
from pathlib import Path
from uuid import uuid4
import psycopg,requests
root=Path.cwd();fixture=json.loads((root/'.local/secret-e2e.json').read_text())
assert fixture['database'].startswith('test_secret_e2e_')
api='http://127.0.0.1:8027/api'
session=requests.post(api+'/auth/login',json={'email':fixture['users'][2]['email'],'password':'local-test-only-password'}).json()
headers={'Authorization':'Bearer '+session['access_token']}
group=requests.post(api+'/servers',headers=headers,json={'name':'Restore test '+uuid4().hex[:8]}).json()
channel=requests.post(api+'/servers/'+group['id']+'/channels',headers=headers,json={'name':'restore','type':'text'}).json()
plain=b'cloud attachment restore test\x00'*40000
r=requests.post(api+'/channels/'+channel['id']+'/messages',headers=headers,data={'content':'encrypted restore sentinel'},files={'files':('restore.txt',plain,'text/plain')});assert r.status_code==201,r.status_code
message=r.json()
work=root/'.local'/('encrypted-restore-'+uuid4().hex[:8]);work.mkdir()
age=root/'.tools/age/age/age.exe';keygen=root/'.tools/age/age/age-keygen.exe';pg=root/'.tools/pgsql/bin'
subprocess.run([str(keygen),'-o',str(work/'identity')],check=True,capture_output=True)
recipient=subprocess.check_output([str(keygen),'-y',str(work/'identity')]).strip().decode()
dump=subprocess.check_output([str(pg/'pg_dump.exe'),'-h','127.0.0.1','-p','55439','-U','audit','-Fc','--exclude-table-data=public.room_*','--exclude-table-data=public.secret_*',fixture['database']])
subprocess.run([str(age),'-r',recipient,'-o',str(work/'database.age')],input=dump,check=True,capture_output=True)
assert b'encrypted restore sentinel' not in dump
with psycopg.connect('host=127.0.0.1 port=55439 user=audit dbname='+fixture['database']) as db:
 row=db.execute('SELECT content, encrypted_content FROM messages WHERE id=%s',(message['id'],)).fetchone();assert row[0]=='' and row[1]
 storage=db.execute('SELECT storage_path FROM attachments WHERE message_id=%s',(message['id'],)).fetchone()[0]
source=root/'.local/secret-e2e-uploads'/storage
if not source.exists():source=root/'.local/secret-e2e-uploads'/storage.removeprefix('uploads/')
assert source.exists(), 'Missing encrypted source'
assert plain[:64] not in source.read_bytes()
stream=io.BytesIO()
with tarfile.open(fileobj=stream,mode='w:gz') as archive:
 archive.add(source,arcname=source.name)
 archive.add(root/'.local/secret-e2e-keyring.json',arcname='keyring.json')
subprocess.run([str(age),'-r',recipient,'-o',str(work/'files.age')],input=stream.getvalue(),check=True,capture_output=True)
restored='test_restore_'+uuid4().hex[:10]
with psycopg.connect('host=127.0.0.1 port=55439 user=audit dbname=postgres',autocommit=True) as db:db.execute('CREATE DATABASE '+restored)
recovered=subprocess.check_output([str(age),'-d','-i',str(work/'identity'),str(work/'database.age')])
subprocess.run([str(pg/'pg_restore.exe'),'-h','127.0.0.1','-p','55439','-U','audit','--exit-on-error','-d',restored],input=recovered,check=True,capture_output=True)
files=subprocess.check_output([str(age),'-d','-i',str(work/'identity'),str(work/'files.age')])
with tarfile.open(fileobj=io.BytesIO(files),mode='r:gz') as archive:archive.extractall(work/'restored',filter='data')
os.environ['TESCORD_DATA_KEYRING_PATH']=str(work/'restored/keyring.json');os.environ['TESCORD_ENVIRONMENT']='development'
sys.path.insert(0,str(root/'backend'))
from app.services.data_encryption import unseal
from app.services.encrypted_files import StoredReader
with psycopg.connect('host=127.0.0.1 port=55439 user=audit dbname='+restored) as db:
 content=db.execute('SELECT encrypted_content FROM messages WHERE id=%s',(message['id'],)).fetchone()[0]
 assert unseal(content,'messages/'+message['id']+'/content')==b'encrypted restore sentinel'
 assert db.execute('SELECT count(*) FROM secret_media_devices').fetchone()[0]==0
with StoredReader(work/'restored'/source.name) as reader:assert reader.read()==plain
broken=bytearray((work/'database.age').read_bytes());broken[-1]^=1
r=subprocess.run([str(age),'-d','-i',str(work/'identity')],input=broken,capture_output=True);assert r.returncode!=0
print('PASS: age-encrypted PostgreSQL + authenticated file + recovery key restored to a separate database; plaintext absent; tampering rejected; ephemeral data excluded.')
