#!/usr/bin/env bash
# 小鲸 APK 打包（2026-11-14 修：dex 用 STORED 写进去，不能用 jar uf）
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
AND="$ROOT"
WORK="$AND/build"
PARENT="$(cd "$ROOT/.." && pwd)"
BT="$PARENT/build/sdk/build-tools/34.0.0"
JAVA="$PARENT/build/jdk-17.0.21+9/bin"
# 塞 dex 要用 python。
# 注意：Windows 上 `python3` 常常指向「应用商店占位程序」，它存在但跑不起来，
# 只会弹商店、什么都不输出，编译就静默失败。所以这里必须「真跑一下」才算数。
# 顺序：$PYTHON → 常见安装位置 → python3 → python，每个都试 --version。

# 真能跑吗？跑 `--version` 看能不能拿到 3.x
python_ok() {
    [ -n "${1:-}" ] || return 1
    command -v "$1" >/dev/null 2>&1 || [ -x "$1" ] || return 1
    "$1" -c "import sys,zipfile; assert sys.version_info[0]==3" >/dev/null 2>&1
}

PY=""

# ① 环境变量指定
if [ -n "${PYTHON:-}" ] && python_ok "$PYTHON"; then
    PY="$PYTHON"
fi

# ② 找常见安装位置（Windows 商店占位程序不会出现在这些地方）
if [ -z "$PY" ]; then
    for c in \
        "$PARENT/../py310/python.exe" \
        "$PARENT/../../py310/python.exe" \
        "$HOME/AppData/Local/Programs/Python/Python313/python.exe" \
        "$HOME/AppData/Local/Programs/Python/Python312/python.exe" \
        "$HOME/AppData/Local/Programs/Python/Python311/python.exe" \
        "$HOME/AppData/Local/Programs/Python/Python310/python.exe" \
        "/c/Python313/python.exe" "/c/Python312/python.exe" \
        "/c/Python311/python.exe" "/c/Python310/python.exe"; do
        if python_ok "$c"; then PY="$c"; break; fi
    done
fi

# ③ PATH 里的 python3 / python
if [ -z "$PY" ]; then
    for c in python3 python; do
        if python_ok "$c"; then PY="$c"; break; fi
    done
fi

if [ -z "$PY" ]; then
    echo ""
    echo "找不到能用的 Python 3。"
    echo "  （Windows 上 python3 常常是应用商店占位程序，看着有其实跑不起来）"
    echo "  请装一个真的 Python 3，或者用环境变量指定："
    echo "    PYTHON=/c/Python312/python.exe bash build.sh"
    echo ""
    exit 1
fi
echo "用的 Python: $PY"

AAPT2="$BT/aapt2.exe"
ZIPALIGN="$BT/zipalign.exe"
APKSIGNER="$BT/apksigner.bat"
JAVAC="$JAVA/javac.exe"
JAVAEXE="$JAVA/java.exe"
APKJAR="$PARENT/build/sdk/platforms/android-34/android.jar"

export JAVA_HOME="$(cygpath -w "$JAVA/..")"
VERSION_NAME="11.0"
VERSION_CODE="110"

echo "=== 清理 ==="
rm -rf "$WORK"
mkdir -p "$WORK/res" "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/apk"

# ============================================================
# 打包前自定义：读 customize.conf，改名字和图标
# ============================================================
# 给了就覆盖，没给就不动（用默认的）
APP_NAME=""
APP_ICON=""
PACKAGE_NAME=""
IN_APP_NAME=""

CONF="$AND/customize.conf"
if [ -f "$CONF" ]; then
    # 读 key=value，跳过注释和空行
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            \#*) continue ;;
            *=*) ;;
            *) continue ;;
        esac
        k="${line%%=*}"
        v="${line#*=}"
        # 去掉首尾空白
        k="$(printf '%s' "$k" | tr -d ' \t\r')"
        v="$(printf '%s' "$v" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s/\r$//')"
        case "$k" in
            appName)     APP_NAME="$v" ;;
            appIcon)     APP_ICON="$v" ;;
            packageName) PACKAGE_NAME="$v" ;;
            inAppName)   IN_APP_NAME="$v" ;;
        esac
    done < "$CONF"
fi

# 没填 inAppName 就跟 appName 一样
if [ -z "$IN_APP_NAME" ] && [ -n "$APP_NAME" ]; then IN_APP_NAME="$APP_NAME"; fi

# ---- 干净收尾：不管成功失败，退出时都把图标和 strings.xml 还原 ----
ICON_BAK="$WORK/_icon_bak"
cleanup() {
    if [ -d "$ICON_BAK" ]; then
        for d in "$ICON_BAK"/*; do
            [ -d "$d" ] || continue
            cp -f "$d/ic_launcher.png" "$AND/res/$(basename "$d")/ic_launcher.png" 2>/dev/null
        done
    fi
    if [ -f "$WORK/strings.xml.bak" ]; then
        mv -f "$WORK/strings.xml.bak" "$AND/res/values/strings.xml"
    fi
}
trap cleanup EXIT

# ---- 图标：转成 5 个尺寸塞进 res/mipmap-* ----

if [ -n "$APP_ICON" ]; then
    ICON_SRC="$APP_ICON"
    case "$ICON_SRC" in
        /*|[A-Za-z]:*) ;;          # 绝对路径，直接用
        *) ICON_SRC="$AND/$APP_ICON" ;;  # 相对 build.sh 所在目录
    esac
    if [ ! -f "$ICON_SRC" ]; then
        echo ""
        echo "【错误】customize.conf 里写的图标找不到：$APP_ICON"
        echo "  实际找的路径：$ICON_SRC"
        echo "  图标请放在 android/ 目录下，或写完整路径。"
        echo ""
        exit 1
    fi
    echo "自定义图标：$ICON_SRC"

    # 备份现有图标
    mkdir -p "$ICON_BAK"
    for d in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
        [ -d "$AND/res/$d" ] || continue
        mkdir -p "$ICON_BAK/$d"
        cp -f "$AND/res/$d/ic_launcher.png" "$ICON_BAK/$d/" 2>/dev/null
    done

    # 用 python 缩放到标准尺寸（真 Python，前面已验证过）
    "$PY" - "$ICON_SRC" "$(cygpath -w "$AND/res")" << 'ICONEOF'
import sys, os
from PIL import Image
src, resdir = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGBA")
# 居中裁成正方形，再缩放到各尺寸
w, h = img.size
side = min(w, h)
img = img.crop(((w-side)//2, (h-side)//2, (w-side)//2+side, (h-side)//2+side))
for d, px in [("mipmap-mdpi",48),("mipmap-hdpi",72),("mipmap-xhdpi",96),
              ("mipmap-xxhdpi",144),("mipmap-xxxhdpi",192)]:
    out = os.path.join(resdir, d, "ic_launcher.png")
    if not os.path.isdir(os.path.dirname(out)): continue
    img.resize((px, px), Image.LANCZOS).save(out, "PNG")
    print("   ", d, str(px)+"x"+str(px))
ICONEOF
fi

# ---- 名字：改 strings.xml ----
if [ -n "$APP_NAME" ]; then
    STRINGS="$AND/res/values/strings.xml"
    cp -f "$STRINGS" "$WORK/strings.xml.bak"
    "$PY" - "$STRINGS" "$APP_NAME" << 'STRSEOF'
import sys, re, io
path, name = sys.argv[1], sys.argv[2]
raw = io.open(path, encoding="utf-8").read()
# XML 转义，别让名字里的 & < > 把清单搞坏
esc = (name.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))
new = re.sub(r'<string name="app_name">.*?</string>',
             '<string name="app_name">' + esc + '</string>', raw, flags=re.S)
io.open(path, "w", encoding="utf-8").write(new)
print("   名字改成：" + name)
STRSEOF
fi

echo ""
echo "  App 名字: ${APP_NAME:-（默认）吃白饭的大肥鱼}"
echo "  App 图标: ${APP_ICON:-（默认）}"
echo "  包名:     ${PACKAGE_NAME:-（默认）com.xiaoman.app}"
echo ""


echo "=== 1. aapt2 compile ==="
"$AAPT2" compile --dir "$(cygpath -w "$AND/res")" -o "$(cygpath -w "$WORK/res.zip")" || exit 1
echo "  res.zip $(stat -c%s "$WORK/res.zip") 字节"

echo "=== 2. aapt2 link ==="
"$AAPT2" link --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" -I "$(cygpath -w "$APKJAR")" --manifest "$(cygpath -w "$AND/AndroidManifest.xml")" --java "$(cygpath -w "$WORK/gen")" -o "$(cygpath -w "$WORK/apk/base.apk")" "$(cygpath -w "$WORK/res.zip")" || exit 1
echo "  base.apk $(stat -c%s "$WORK/apk/base.apk") 字节"

echo "=== 3. javac ==="
SRCS=$(find "$AND/src" "$WORK/gen" -name "*.java")
"$JAVAC" -encoding UTF-8 --release 8 -classpath "$(cygpath -w "$APKJAR")" -d "$(cygpath -w "$WORK/classes")" $SRCS > "$WORK/javac.log" 2>&1
CNT=$(find "$WORK/classes" -name "*.class" | wc -l)
echo "  class: $CNT 个"
if [ "$CNT" -lt 5 ]; then echo "  ✗ 编译失败"; head -30 "$WORK/javac.log"; exit 1; fi

echo "=== 4. d8 ==="
cd "$WORK/classes"
"$JAVAEXE" -cp "$(cygpath -w "$BT/lib/d8.jar")" com.android.tools.r8.D8 --debug --min-api 21 --lib "$(cygpath -w "$APKJAR")"  --output "$(cygpath -w "$WORK/dex")" $(find . -name "*.class") > "$WORK/d8.log" 2>&1
cd "$ROOT"
echo "  classes.dex $(stat -c%s "$WORK/dex/classes.dex") 字节"

echo "=== 5. 塞 dex（STORED，不压缩） ==="
"$PY" - "$(cygpath -w "$WORK/apk/base.apk")" "$(cygpath -w "$WORK/dex/classes.dex")" "$(cygpath -w "$WORK/apk/unsigned.apk")" << 'PYEOF'
import sys, zipfile, shutil
base, dex, out = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.copy(base, out)
# 用 STORED 写入（Android 对压缩过的 dex 有时解析失败）
with zipfile.ZipFile(out, 'a', zipfile.ZIP_STORED) as z:
    z.write(dex, 'classes.dex')
print("  写入完成")
PYEOF
# 塞完必须验证：文件在、dex 在里面。不然下一步 stat 报错，白跑一遍
if [ ! -f "$WORK/apk/unsigned.apk" ]; then
    echo ""
    echo "【失败】塞 dex 那一步没产出文件。"
    echo "  最常见原因：Python 跑不起来（Windows 应用商店占位程序）。"
    echo "  上面已经打印了用的 Python 是哪个，把它换成真 Python 再试："
    echo "    PYTHON=/c/Python312/python.exe bash build.sh"
    echo ""
    exit 1
fi
echo "  $(stat -c%s "$WORK/apk/unsigned.apk") 字节"

echo "=== 6. zipalign ==="
"$ZIPALIGN" -f -p 4 "$(cygpath -w "$WORK/apk/unsigned.apk")" "$(cygpath -w "$WORK/apk/aligned.apk")" || exit 1
echo "  $(stat -c%s "$WORK/apk/aligned.apk") 字节"

echo "=== 7. 签名 ==="
KEYSTORE="$(cygpath -w "$AND/xiaoman.keystore")"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass pass:xiaoman123 --ks-key-alias xiaoman --key-pass pass:xiaoman123 --out "$(cygpath -w "$WORK/小鲸-v$VERSION_NAME.apk")" "$(cygpath -w "$WORK/apk/aligned.apk")" || exit 1

echo ""
echo "  ✓ APK: $WORK/小鲸-v$VERSION_NAME.apk"
echo "  大小: $(( $(stat -c%s "$WORK/小鲸-v$VERSION_NAME.apk") / 1024 )) KB"
echo "  版本: v$VERSION_NAME ($VERSION_CODE)"
"$APKSIGNER" verify --print-certs "$(cygpath -w "$WORK/小鲸-v$VERSION_NAME.apk")" 2>&1 | grep -i "SHA-256"
