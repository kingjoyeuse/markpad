"""Regenerate Windows size-specific icons from assets/markpad-source.png.
Uses Pillow for lossless format conversion and alpha-correct resampling; no artwork replacement.
Small ICO frames use 32-bit DIB + correct DWORD-aligned transparency masks.
"""
from pathlib import Path
from PIL import Image
import io,struct
root=Path(__file__).resolve().parents[1]
im=Image.open(root/'assets/markpad-source.png').convert('RGBA')
r,g,b,a=im.split();a=a.point(lambda x:0 if x<5 else 255 if x>=250 else x);im.putalpha(a)
box=a.point(lambda x:255 if x>32 else 0).getbbox();im=im.crop(box)
master=Image.new('RGBA',(1024,1024));im.thumbnail((960,960),Image.Resampling.LANCZOS);master.alpha_composite(im,((1024-im.width)//2,(1024-im.height)//2))
frames=[]
for size in [16,20,24,32,40,48,64,128,256]:
 frame=master.resize((size,size),Image.Resampling.LANCZOS)
 if size==256:frame.save(root/'assets/markpad.png')
 if size<=64:
  rgba=frame.tobytes();stride=((size+31)//32)*4;mask=bytearray(stride*size);pixels=bytearray()
  for outrow,y in enumerate(range(size-1,-1,-1)):
   for x in range(size):
    r,g,b,a=rgba[(y*size+x)*4:(y*size+x+1)*4]
    if a<=3:r=g=b=a=0;mask[outrow*stride+x//8]|=1<<(7-x%8)
    pixels.extend((b,g,r,a))
  data=struct.pack('<IiiHHIIiiII',40,size,size*2,1,32,0,len(pixels),0,0,0,0)+pixels+mask
 else:
  buff=io.BytesIO();frame.save(buff,format='PNG');data=buff.getvalue()
 frames.append((size,data))
header=struct.pack('<HHH',0,1,len(frames));entries=b'';payload=b'';offset=6+16*len(frames)
for size,data in frames:
 entries+=struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset);payload+=data;offset+=len(data)
(root/'assets/markpad.ico').write_bytes(header+entries+payload)
print('Rebuilt PNG and ICO with 16/20/24/32/40/48/64/128/256 px frames.')
