# Artworkの中心を等間隔に配置

## 操作

1. **Open**で[artwork-distribution.json](../examples/artwork-distribution.json)を開きます。図形、回転と負のScaleを持つ星、編集可能なText、Bezier Curve、埋め込み画像が入っています。
2. Layersで**Silver tile**をクリックし、ほかの可視Artwork名をShiftクリックして3件以上選びます。キャンバスのShiftクリックでも追加・解除できます。
3. Inspectorの**中心を等間隔**で**横方向**または**縦方向**を選びます。最終描画boundsの中心を選んだ軸で並べ、両端の中心を固定して、中間のArtworkを等間隔に配置します。ボタンはTabとEnterでも操作できます。
4. 選択集合、active layerのグラフ、pan/zoomは維持されます。Undoを1回行うと全件が戻り、Redoで復元します。同じ操作を繰り返しても、すでに中心が等間隔なら履歴は増えず、既存のRedoも残ります。
5. **Save JSON**で独立した編集可能なグラフを保存します。再読込後も各Artworkを個別に編集できます。**Export SVG / PNG**には選択枠や操作UIを含めません。

同じ中心座標のArtworkはドキュメントのレイヤー順で並べます。クリックして選んだ順序には依存しません。全件の中心が同じ座標なら何も変更しません。幅や高さが違うArtworkでは、中心間隔が等しくても見た目の隙間は等しくなりません。

## 対象と拒否

3〜100件の異なるArtworkが対象です。全件が既存の[Artwork移動](multi-artwork-movement.md)と同じ条件を満たす必要があります。shape / unattached Text → solid Fill → Output、shape/Textのterminal Transform、direct Curve → solid Fill → Output、Image → Image Outputを扱います。Curveは2〜128 anchorです。

locked、hidden、guide、bypassed、空または非有限bounds、接続・式で駆動された位置、未対応グラフ、利用できないフォントや画像が1件でも含まれると、対象名と理由を表示して**全件を拒否**します。固定する両端も検証対象です。Shiftクリックで該当Artworkを外すか、状態を直してから実行してください。

この操作は中心の等間隔配置だけを行います。等しい隙間、指定間隔、group、resize、範囲選択は含みません。既存の6方向整列は[別の操作](artwork-alignment.md)です。

## 実装と検証

実行直前の最終Outputを評価したboundsを使います。Textの実アウトライン、Transformの回転・負Scale・Offset、CurveのBezier、Imageの最終矩形を反映します。中間Artworkの位置、terminal Transform Offset、Curveの全anchor Positionだけを移動し、relative handle、サイズ、回転、塗り、接続、非選択layer、両端の保存値を維持します。

全対象を新しく解決し、既存の移動計画・値/schema検証・候補Outputの再評価を通してから書き込みます。候補が失敗しても文書とUndo/Redoは変えません。Textの`toPathData(5)`による丸めと、整列で使う1e-5単位のno-op許容値を共用します。最初のdeltaを丸めることはありません。通常の幾何誤差の判定は既存の1e-9です。

IME composition、modal、Pen、rename、ドラッグやwireなどの操作中はボタンを無効にし、強制されたclickも拒否します。古い選択やactive layerに結びついたボタンを実行しません。

`npm run check`はモデルと実handlerのDOMテストを含みます。`npm run test:e2e`には`artwork-distribution.e2e.js`を登録しています。実Chromeで横・縦の描画中心、両端固定、選択と表示位置、単一Undo、no-opとRedo維持、一括拒否、操作中のガード、JSON/SVG/PNG保存と再編集、1600×1000と1280×800の画面を確認します。CI artifact内の`test-results/artwork-distribution-*.png`と`workflow-artwork-distribution.*`がこの操作の証拠です。

native WebView2、日本語IME、dialog、high DPIの実機確認は保留です。Chromeのcompositionイベントはnative IMEの証拠にはなりません。SHIRO-WSでNectのnativeアプリやinstallerは実行しません。
