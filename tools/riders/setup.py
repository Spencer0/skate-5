import os
MH = os.environ.get('MH_WORK', '/tmp/mh/')  # work dir: sysassets/, orig_*.png, out/
import bpy, os, shutil, sys
ext_root = bpy.utils.user_resource('EXTENSIONS', path='user_default')
os.makedirs(ext_root, exist_ok=True)
dst = os.path.join(ext_root, 'mpfb')
if not os.path.exists(dst):
    shutil.copytree(os.environ.get('MPFB_SRC', '/home/user/makehumancommunity/mpfb2/src/mpfb'), dst)
bpy.ops.extensions.repo_refresh_all() if hasattr(bpy.ops.extensions, 'repo_refresh_all') else None
r = bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
print('enable', r)
home = bpy.utils.extension_path_user('bl_ext.user_default.mpfb', create=True)
print('USER_HOME', home)
data = os.path.join(home, 'data')
os.makedirs(data, exist_ok=True)
for d in os.listdir(MH + 'sysassets'):
    t = os.path.join(data, d)
    if not os.path.exists(t):
        os.symlink(os.path.join(MH + 'sysassets', d), t)
bpy.ops.wm.save_userpref()
print(os.listdir(data))
