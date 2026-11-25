; installer.nsh: インストーラ(electron-builder の NSIS)に足す手順。論点 0055 / 0072 / 0073。
;
; ファイルを入れたあと、入れたアプリを補助モードで起動し、インストーラと同じフォルダ($EXEDIR)の重みの別ファイルを
; 照合して置き場にコピーさせ、テキストモデルを Ollama に取り込ませる(src/main/weightInstallMode.ts)。
; 通信はしない(重みは同じフォルダのファイルから取る。S0055_05)。同意の画面(license)はこの手順より前に出る(S0047_02 / S0047_03)。
; 失敗したら補助モードが書いた文面(足りない・一致しないファイルの名前など)を出し、入れたファイルを消してインストールを完了しない。
; 保存したもの({userData})はここでは消さない。消すのはアンインストールのときだけ(deleteAppDataOnUninstall。更新では消えない。S0048_14)。

!macro customInstall
  InitPluginsDir
  DetailPrint "モデルの重みを照合して置いています。数分かかります…"
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--install-weights=$EXEDIR" "--message-file=$PLUGINSDIR\weights-message.txt"' $0
  ${If} $0 != 0
    StrCpy $2 ""
    ClearErrors
    FileOpen $1 "$PLUGINSDIR\weights-message.txt" r
    ${IfNot} ${Errors}
      readLoop:
        ClearErrors
        FileReadUTF16LE $1 $3
        IfErrors readDone
        StrCpy $2 "$2$3"
        Goto readLoop
      readDone:
      FileClose $1
    ${EndIf}
    ${If} $2 == ""
      StrCpy $2 "モデルの重みを置けませんでした(終了コード $0)。もう一度インストールしてください。"
    ${EndIf}
    MessageBox MB_ICONSTOP|MB_OK "$2"
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
    Abort "モデルの重みを置けなかったため、インストールを中止しました。"
  ${EndIf}
!macroend

; 論点 0075 インストーラから削除を選べる。.onInit(同意の画面より前)で、入っているかを登録情報の InstallLocation で見る。
; 削除はアンインストール(S0048_13)と同じものを消す — 入っているアンインストーラを、アプリのデータも消す指定で動かす。
; アンインストーラは自分を一時フォルダへ写して起動し直すので、そのままでは ExecWait が終わりを待てない。
; electron-builder の更新と同じく一時フォルダへ写してから `_?=` で入っている場所を渡し、終わるまで待つ。
; 削除には重みの別ファイルも同意の画面も要らない(S0075_05)。通信はしない(S0075_06)。
!macro customInit
  Var /GLOBAL keycheerInstalled
  ReadRegStr $keycheerInstalled HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $keycheerInstalled == ""
    Goto removeSkip
  ${EndIf}
  ${IfNot} ${FileExists} "$keycheerInstalled\${UNINSTALL_FILENAME}"
    Goto removeSkip
  ${EndIf}

  removeChoice:
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "KeyCheer はすでに入っています。$\r$\n$\r$\nはい … 更新する$\r$\nいいえ … 削除する$\r$\nキャンセル … 中止する" IDYES removeSkip IDNO removeConfirm
    Goto removeCancelled

  removeConfirm:
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "KeyCheer を削除します。アプリと、重み・キャラクター・設定・統計がすべて消えます。よろしいですか?" IDCANCEL removeChoice
    InitPluginsDir
    CopyFiles /SILENT "$keycheerInstalled\${UNINSTALL_FILENAME}" "$PLUGINSDIR\keycheer-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\keycheer-uninstaller.exe" /S /currentuser --delete-app-data _?=$keycheerInstalled' $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "削除できませんでした(終了コード $0)。KeyCheer を終了してから、もう一度実行してください。"
      Quit
    ${EndIf}
    ; `_?=` で動かしたアンインストーラは自分のファイルとフォルダを残すので、ここで消す
    Delete "$keycheerInstalled\${UNINSTALL_FILENAME}"
    RMDir "$keycheerInstalled"
    MessageBox MB_ICONINFORMATION|MB_OK "KeyCheer を削除しました。"
    Quit

  removeCancelled:
    Quit

  removeSkip:
!macroend
