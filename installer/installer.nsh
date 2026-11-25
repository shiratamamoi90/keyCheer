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

; 論点 0075 / 0076 インストーラから削除を選べる。名前は ${PRODUCT_NAME}(package.json の productName。論点 0077)。入っているときだけ、最初(同意の画面より前)に自作のページを出し、
; 「更新する」「削除する」のボタンと、下の「キャンセル」(インストーラ標準。何も変えずに終わる)で選ばせる。
; NSIS の確認の画面(MessageBox)はボタンの名前を「はい / いいえ」から変えられないので使わない(論点 0076)。
; 入っているかは、electron-builder が書く登録情報の InstallLocation と、そこにあるアンインストーラで見る。
; 削除はアンインストール(S0048_13)と同じものを消す — 入っているアンインストーラを、アプリのデータも消す指定で動かす。
; アンインストーラは自分を一時フォルダへ写して起動し直すので、そのままでは ExecWait が終わりを待てない。
; electron-builder の更新と同じく一時フォルダへ写してから `_?=` で入っている場所を渡し、終わるまで待つ。
; 削除には重みの別ファイルも同意の画面も要らない(S0075_05)。通信はしない(S0075_06)。
!macro customWelcomePage
  Var keycheerInstalled
  Var keycheerNextButton

  Page custom keycheerChoicePageCreate keycheerChoicePageLeave

  Function keycheerChoicePageCreate
    ReadRegStr $keycheerInstalled HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $keycheerInstalled == ""
      Abort
    ${EndIf}
    ${IfNot} ${FileExists} "$keycheerInstalled\${UNINSTALL_FILENAME}"
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "${PRODUCT_NAME} はすでに入っています" "更新するか、削除するかを選んでください。"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 40u "更新する … 新しい版に入れ替えます。作ったキャラクターと設定は残ります。$\r$\n$\r$\n削除する … アプリと、重み・キャラクター・設定・統計をすべて消します。"
    Pop $0
    ${NSD_CreateButton} 0 52u 90u 18u "更新する"
    Pop $0
    ${NSD_OnClick} $0 keycheerUpdateClicked
    ${NSD_CreateButton} 100u 52u 90u 18u "削除する"
    Pop $0
    ${NSD_OnClick} $0 keycheerRemoveClicked
    ; 選ぶのはページのボタンだけにする(下の「次へ」は隠し、次のページで戻す)
    GetDlgItem $keycheerNextButton $HWNDPARENT 1
    ShowWindow $keycheerNextButton ${SW_HIDE}
    nsDialogs::Show
  FunctionEnd

  Function keycheerChoicePageLeave
    ShowWindow $keycheerNextButton ${SW_SHOW}
  FunctionEnd

  ; 更新する:今のインストールの手順(同意の画面)へ進める
  Function keycheerUpdateClicked
    Pop $0
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  ; 削除する:確かめてから消す。取りやめたらこのページに戻る(S0075_03)
  Function keycheerRemoveClicked
    Pop $0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} を削除します。アプリと、重み・キャラクター・設定・統計がすべて消えます。よろしいですか?" IDOK keycheerRemoveConfirmed
    Return
    keycheerRemoveConfirmed:
    InitPluginsDir
    CopyFiles /SILENT "$keycheerInstalled\${UNINSTALL_FILENAME}" "$PLUGINSDIR\keycheer-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\keycheer-uninstaller.exe" /S /currentuser --delete-app-data _?=$keycheerInstalled' $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "削除できませんでした(終了コード $0)。${PRODUCT_NAME} を終了してから、もう一度実行してください。"
      Quit
    ${EndIf}
    ; `_?=` で動かしたアンインストーラは自分のファイルとフォルダを残すので、ここで消す
    Delete "$keycheerInstalled\${UNINSTALL_FILENAME}"
    RMDir "$keycheerInstalled"
    MessageBox MB_ICONINFORMATION|MB_OK "${PRODUCT_NAME} を削除しました。"
    Quit
  FunctionEnd
!macroend
