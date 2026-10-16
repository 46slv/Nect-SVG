# 複数Artworkの整列

## 操作

1. **Open**で[artwork-alignment.json](../examples/artwork-alignment.json)を開きます。長方形、回転と負のScaleを持つ星、編集可能なText、Bezier Curve、画像を収録しています。
2. Layersの**Silver tile**をクリックし、ほかの可視Artwork名をShiftクリックして追加します。キャンバスでもShiftクリックで追加・解除できます。
3. Inspectorの**Align artwork**で**Left / Horizontal center / Right**または**Top / Vertical center / Bottom**を選びます。基準は実行直前の選択集合を囲むboundsです。
4. 選択集合、active layerのグラフ、pan/zoomはそのままです。Undoを1回実行すると全件が戻り、Redoで整列を復元できます。同じ整列を繰り返しても履歴は増えません。
5. **Save JSON**で編集可能な独立グラフを保存し、**Export SVG / PNG**で出力します。開き直すと位置は保持され、作業中の選択は解除されます。

対応できないArtworkが1件でも含まれると、Inspectorに対象名と理由を表示し、全件の整列を拒否します。locked、hidden、guide、空または非有限のbounds、式や接続で駆動される位置、未対応のグラフなどが対象です。Shiftクリックで問題のArtworkを選択から外すか、その状態を修正して再実行してください。一部だけを自動的に移動することはありません。

## 実装契約

画面は既存の作業面とInspectorを維持し、操作は3列×2行のコンパクトなボタンにまとめます。各ボタンはキーボードから操作でき、名前・無効状態・基準を表示します。Guide設定やnode内部の整列とは独立した最終Artwork操作です。基準をアートボードやactive Artworkに切り替える機能はありません。

`resolveArtworkMoveTarget`が隔離したlayerを実際に評価し、最終Outputの`pathBounds`を返します。Textは字形アウトライン、Transformは回転・負Scale・Offsetを反映した最終形状、CurveはBezierのbounds、Imageは最終矩形を使用します。文字数やsource nodeの幅からの推測は行いません。既存の移動経路だけを使い、位置またはterminal TransformのOffset、Curveの全anchor Positionへ各Artwork固有のdeltaを加えます。relative handle、サイズ、回転、塗り、接続、非選択layerは変更しません。

全対象を新たに解決し、全位置の移動計画・候補の検証・移動後Outputの再評価を終えてから実文書に書き込みます。finite値、既存の値・schema検証、100 layerの上限、Curveの128 anchor移動上限を維持します。例外時は文書もUndo/Redoも変更しません。対応状態を保存したボタンでも実行時に再検証し、古い選択やactive layerの操作は拒否します。

coreの既存Text評価は`layout.path.toPathData(5)`で座標を5桁にします。このためTextを含む再整列では1e-5文書単位以内を既存描画精度で整列済みと判定します。最初の移動量は実boundsから求めた値を丸めずに使います。モデルテストは保存される全位置がそのdeltaと完全一致することも検証します。

IME composition、modal、Pen、rename、ドラッグ・wireなどのgesture中は操作を無効にし、強制されたclickも変更を起こしません。通常の履歴操作で選択集合とactive stateを復元します。範囲選択、group、distribution、resize、batch duplicate/delete、未対応グラフの自動変換は対象外です。

## 検証

`npm run check`にモデルと実handlerのDOMテスト、`npm run test:e2e`に`artwork-alignment.e2e.js`を含めています。実Chromeでは6方向のSVG bounds、単一Undo/no-op、選択・active・pan/zoom保持、拒否・競合防止、JSON/SVG/PNGの保存と再読込、1600×1000と1280×800の画面を確認します。成果物はCI artifactの`test-results/workflow-artwork-alignment.*`と`artwork-alignment-*.png`です。

Chromeでのcompositionイベントはnative日本語IMEの証拠にはなりません。native WebView2、IME、dialog、high DPIの操作確認は保留です。SHIRO-WSではNectのnativeアプリとinstallerを実行しません。
