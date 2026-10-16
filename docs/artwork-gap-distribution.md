# Artworkの隙間を等間隔にする

幅や高さの異なるArtworkを、描画結果の端から次の端まで同じ間隔で並べます。中心間の距離を揃える「中心を等間隔」とは別の操作です。

1. [編集用サンプル](../examples/artwork-gap-distribution.json)をOpenで開きます。
2. LayersのSilver tileからEmbedded swatchまで、5つのArtwork名をShiftクリックで選択します。
3. Inspectorの「隙間を等間隔」で「横方向」または「縦方向」を押します。横方向は右端から次の左端、縦方向は下端から次の上端を揃えます。
4. Undoで全体を1回で戻せます。Redoも選択とactive layerを復元します。続けて同じ方向を押しても、配置済みなら履歴は増えず、Redoも残ります。
5. SaveしたJSONを開き直せば、図形・Text・Curve・Imageは独立したまま再編集できます。SVG/PNGには選択表示や配置ボタンを含めません。

## 両端と重なりの扱い

横方向は最も左の端を持つArtworkと最も右の端を持つArtworkを丸ごと固定します。縦方向は最上端・最下端です。中間Artworkは左端または上端の順に並べ、同値ならドキュメントのlayer順を使います。左・上の端が同値なら先のlayer、右・下の端が同値なら後のlayerを固定するので、クリックした順には依存しません。

隙間は「後端Artworkの開始端 − 前端Artworkの終了端 − 中間Artworkの幅／高さの合計」を「選択数 − 1」で割ります。負の値は重なりとして適用し、Artworkを縮めません。たとえば横幅50・80・50、外側の範囲が0〜150なら、隙間は−15となり、中間Artworkは35〜115に移動します。

1つのArtworkが両方の最外端を占める場合や、移動すると並び順・固定両端が変わるほど深い重なりになる場合は、全体を変更せず理由を表示します。少し広げてからやり直してください。重なりを含め、成功後の再実行は同じ結果になります。

## 対応範囲

3〜100個の重複しないArtworkを選択します。最終Outputを毎回評価し、Textの実アウトライン、回転・負Scaleを含むterminal Transform、Bezier Curve、Imageのboundsを使います。既存の安全なArtwork移動経路を使い、位置またはCurveの全anchor Positionだけを変更します。サイズ・回転・相対handle・塗り・接続・layer順・非選択Artworkは保持します。

ロック・非表示・guide・bypass・空の出力・式や接続で駆動された移動値・複雑な未対応グラフは選択全体を拒否します。Curve移動は128 anchorsまでです。固定両端も検証対象です。全移動を複製上で計画し、保存値の検証と最終boundsの再評価を通してから一括で書き込みます。拒否・no-opは履歴を変えません。

Textには既存の`toPathData(5)`精度を使います。独立して丸められた端同士の差を比較するため、実際の隙間の最大値と最小値の差が4×既存精度以内なら配置済みと判定します。Textを含むと約0.00004、その他は0.000000004です。最初の移動deltaは丸めません。成功前後で同じ判定を使うので、多数のTextでも丸め誤差が積み重なって再実行時に微移動することはありません。

IME composition・modal・Pen・rename・drag・wireなどの編集中は無効です。古い選択やactive layerを参照するボタン、強制されたclickも検証します。

モデル／DOMテストは`npm test`、実Chromeは`artwork-gap-distribution.e2e.js`です。1600×1000・1280×800・1024×768での操作、負の隙間、連打、中断、Undo/Redo、保存・再読込・再編集、SVG/PNGを検証します。画面はCI artifactの`artwork-gap-*.png`、保存結果は`workflow-artwork-gap-*`に残ります。

native WebView2・実IME・native dialog・high DPIの実機確認は保留です。Chromeのcompositionイベントは実IMEの証拠にはなりません。nativeアプリとinstallerは実行しません。
