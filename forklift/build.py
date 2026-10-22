import glob,re
s=open('index.html',encoding='utf-8').read()
code='\n'.join(open(f,encoding='utf-8').read() for f in sorted(glob.glob('v10/*.js')))
code='  function initializeV10(){\n'+code+'\n  }\n'
i=s.index('/*V10:BEGIN*/')+len('/*V10:BEGIN*/'); j=s.index('/*V10:END*/')
open('index.html','w',encoding='utf-8').write(s[:i]+'\n'+code+'  '+s[j:])
