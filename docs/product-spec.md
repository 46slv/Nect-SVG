# Nect SVG 製品仕様書

更新日: 2026-10-14（UTC）

この文書は、承認済みの方向性、現在の実装、次に実装する内容をまとめた仕様の入口です。「実装済み」「検証済み」「次に実装」を区別します。個別の制限や検証証跡は末尾の資料を参照してください。

## 1. 目的と提供範囲

- ノードで形状を組み立て、キャンバス上でも編集できる、単体のベクター制作アプリを先に成立させる。
- 主対象は Windows デスクトップ。Tauri 2 + WebView2 を採用し、ブラウザー版と DOM に依存しない SVG 評価・出力エンジンを共有する。
- Nect / Nect-Cloud への統合は将来の別判断。現時点で統合、クラウドサービス、公開リリースの完成を意味しない。
- 編集の正本はプロジェクト JSON。SVG / PNG は評価後の作品出力であり、ノードや編集履歴の代替ではない。

## 2. 画面と編集モデル

Resolve / Blender のように制作面とノードを併用する、白・シルバー基調の密度のあるデスクトップ UI とする。上部にファイル操作、左にツール、上段にキャンバス、下段に高さを変えられるノードグラフ、右に Layers / Inspector を配置する。アートボードの角は四角いままにする。特定製品の全ショートカット互換は要求しない。

**1 レイヤー = 1 ノードコンポジション**。レイヤーごとに出力、表示、ロック、重なり順を持ち、コンポジションをまたぐ接続はしない。キャンバスと Inspector とノードは同じモデルを編集する。ノードカードの座標・幅・折りたたみと、作品の座標・サイズは別の状態である。

Layers の **Forward / Backward** は、その行の安定 ID を持つレイヤーを重なり順で 1 段だけ入れ替える。選択、グラフ、座標、アセットは変更せず、1 回の Undo で正確に戻る。ロック対象と進行中の編集は拒否し、端では履歴を消費しない。非表示・ガイド・空・複雑なグラフも対象とする。[安全なレイヤー順序変更](artwork-layer-ordering.md)。

パラメーターの優先順位は **接続 → Expression → 直接値**。接続を外すと保存済みの Expression / 値に戻る。型違い、循環、ロックを破る操作は拒否し、変更前のデータを残す。キャンバスの移動は選択した生成ノードを編集し、下流 Boolean の結果を逆算したり、暗黙の Transform を追加したりしない。

### アートボードの表示移動

拡大後も、キャンバス上の中ボタンドラッグまたは Space + 左ドラッグで表示を移動する。図形・ガイド・Pen より表示移動を優先し、入力欄や contenteditable 内の Space は文字入力として扱う。キャプチャにより領域外でもドラッグを継続し、離す・Escape・pointercancel・キャプチャ喪失・ウィンドウフォーカス喪失で終了する。終了時の表示位置を保ち、ドキュメント・選択・Undo を変更しない。Fit で倍率と表示位置を初期化する。

### 数値のドラッグ調整

Inspector とノード内の Scalar / Vector2 各成分・色 alpha は、数値を押したまま左右へドラッグすると増減する。4 px を超える横移動から開始し、以降は 1 px ごとに通常 1、scale と alpha は 0.01 変化する。上下移動だけでは変更しない。クリックは直接入力、右端のスピンボタンとキーボード矢印は従来どおり使用できる。修飾キーで倍率は変更しない。

ドラッグ中は作品をプレビューし、離すと 1 回の Undo にまとめる。元の値に戻った操作と単なるクリックは履歴に追加しない。Escape、pointercancel、ポインターキャプチャ喪失、ウィンドウのフォーカス喪失では開始前の値へ戻し、履歴を追加しない。ロック・接続・Expression の値はドラッグ編集しない。Stroke / Polygon / Star / Repeater / alpha の範囲を守り、Star の内外半径の順序も維持する。ノードの位置は動かさない。

## 3. 形状・色・出力

### 3.1 型と形状

値の型は Scalar、Vector2、Boolean、Color、Path、PaintedPath、Image。Circle / Ellipse / Rectangle / Curve / Text / Imported Path から Path を生成する。Join Geometry は形状を独立したグループとして束ねる。Geometry Repeater は線形／放射に複製する。Boolean は結合・差分・交差・排他的差分に対応し、Transform、Convert to Path、Text to Path、Path Remap と組み合わせる。面積 Boolean に開いた輪郭を渡した場合はエラーとする。

Curve は頂点と相対 Bézier ハンドルを自身で持つ。Pen はクリックで角点、ドラッグでハンドル、始点クリックで閉じ、Escape で開いた線として終了する。

Path Remap は上流を壊さず頂点・ハンドルの差分を編集する。Boolean / Text / Imported Path などで上流形状が変わり対応が保証できなくなった場合、既存差分を保存したまま停止し、明示的な Rebind を必要とする。自動で近傍の別頂点へ付け替えない。複数点の移動は全対象が編集可能な場合だけ一括適用する。

### 3.2 明示的なペイント

標準の流れは **形状 Path → 必要な形状操作 → Fill / Stroke → Output**。

- Fill と Stroke は Path または PaintedPath を受け、PaintedPath を返す。形状操作はペイントより前に置く。
- Color は `#RRGGBB` と alpha（0〜1）。Fill / Stroke の color 入力に接続する。Color に数式は使用しない。
- Fill は塗りだけ、Stroke は線だけを変更し、もう一方を保持する。同じ種類を重ねた場合は最後の指定が有効。
- Stroke の width は有限の Scalar、単位 px、0〜100000。塗りと線の alpha は独立し、0 も保持する。
- 裸の Path を Output に接続しても暗黙の塗りは付けない。図形ツールや「Use as output」は便宜上、明示的な Fill を追加する。
- 複数の塗り・線を保持するペイントスタック、グラデーション、混色、色管理変換は現実装に含めない。

### 3.3 旧 JSON の互換

新規プロジェクトは schemaVersion 2。schemaVersion 1 は読み込み時に明示的な Fill へ移行し、見た目、既存 ID、接続、直接値、Expression、ロックを保つ。旧レイヤー色への参照が必要な場合も維持する。旧 Output を形状入力として使う接続はペイント前の形状へ戻す。移行は自動保存せず、利用者の保存で新形式を確定する。不正データや上限超過は現在のプロジェクトを置き換えず拒否する。

## 4. 数値・ベクトルノード

### 4.1 実装済み: Separate Vector → Math → Combine Vector

Value は Scalar、Vector は Vector2 を供給する。

- Separate Vector: Vector2 を入力し、独立した X / Y の Scalar 出力を持つ。接続は `source` に加え `sourcePort: "x"` または `"y"` を保存する。従来の既定出力は sourcePort を省略する。Text の追加 Position 出力は第 17 節を参照。
- Math: Add / Subtract / Multiply / Divide / Min / Max / Abs / Clamp。演算に必要な入力だけを表示・評価する。非表示になった入力値・接続は破棄せず、構造・循環の検証対象として残す。
- Combine Vector: Scalar の X / Y を Vector2 に組み立てる。
- Divide のゼロ除算は 0。Clamp は上下限を含み、最小値 > 最大値はエラー。NaN / Infinity、非有限の入力・結果はエラー。
- 既存 Expression の計算規則は変更しない。式は安全な数値パーサーで扱い、JavaScript の任意実行は許可しない。

受入例: Vector の X / Y を分離し、片方だけ Math で調整して再結合し、図形の位置やサイズへ接続できる。保存・再読込、Undo / Redo、折りたたみ中の接続でも X / Y の区別を失わない。

### 4.2 Vector Math（実装済み、現チェックポイントの実 Chrome 検証待ち）

実装順は Separate / Math / Combine の実ブラウザー検証を先に終え、その後 Vector Math。2026-10-14 の方針合意に基づく。以下はソースへ実装済みで、現チェックポイントの実 Chrome・パッケージ検証を待つ。

- XY の成分別 Add / Subtract / Multiply / Divide と、Scale / Normalize / Length / Distance / Dot を扱う。Scale は Vector2 と Scalar、Normalize は Vector2 を入力して Vector2 を返す。Length / Distance / Dot は Scalar を返す。Normalize のゼロ長入力 `[0,0]` は `[0,0]` を返す。
- ベクトルを返す演算と Scalar を返す演算を区別し、演算切替時に出力型を更新する。
- 型の変化で既存接続が壊れる場合は切替全体を拒否する。接続を黙って切らず、非表示入力、ロックされた入力、頂点入力も検査する。
- 新しい演算ノードのゼロ除算は 0 とする方針を共有し、NaN / Infinity はエラーにする。既存 Expression はそのまま保つ。
- UI、保存、履歴、評価キャッシュ、配線、型違いの拒否を一体で検証する。すべての入力・結果は有限値に限定し、演算のオーバーフローもエラーとする。成分別 Divide は分母が 0 の成分を 0 にする。これらを unit / DOM / Chrome の受入テストへ追加している。

## 5. ノード操作と取り消し

- 入力ポートはカード左境界、出力ポートは右境界。未接続入力は通常隠し、接続中は適合する候補を表示する。接続メニューも用意する。
- 入力を空白へドラッグ、または入力の右クリックで切断する。折りたたんでも出力と接続済み入力を残し、配線中は適合する空き入力を一時表示する。
- 中ボタンドラッグ、Ctrl/Cmd+Shift+ドラッグ、Space+ドラッグでグラフをパン。Ctrl/Cmd+ホイールで 5〜200% ズーム。通常のホイールスクロールは残す。フォーム入力上からは操作を開始しない。
- グラフにフォーカスがあるとき Ctrl/Cmd+1 は等倍、Reset view はズームとスクロールをリセットする。Shift+1 / Fit all は全ノード、Shift+2 / Fit selection は選択ノードの実測カード範囲へ合わせる。
- ノードを端へドラッグすると連続自動スクロールし、右・下へ領域を拡張する。左・上は非負の原点で止め、グループ移動でも相対位置を保つ。
- 1 回の完了した編集ジェスチャーは Undo 1 回。キャンセル、ポインター中断、フォーカス喪失では開始前へ戻し、後続の移動・release で勝手に再開しない。
- Ctrl+Z / Ctrl+Shift+Z で Undo / Redo。履歴はセッション内のみで JSON には保存しない。

### 5.1 配線プレビュー（実装済み、現チェックポイントの実 Chrome 検証待ち）

2026-10-14 の追加要求: 接続元からドラッグ中のポインターまでワイヤーを表示する。既存の適合入力ハイライトと併用し、接続先へ到達する前も配線の出発点と行き先を追えること。キャンセル・中断・不適合先での release は接続を作らず、プレビューを消す。接続が成立する drop では実配線へ置き換え、不成立時は既存モデルを変えない。完成後は拡大縮小・スクロール・折りたたみ、ポインター中断、Separate Vector の X / Y の sourcePort を区別した開始位置と接続結果を組み合わせて検証する。青い破線のプレビューを実装済み。現チェックポイントの実 Chrome 検証が完了するまで、ブラウザー受入合格とはしない。

### 5.2 入力確定・中断・モデル整合性

- 数値・テキストの入力中ドラフトは change で確定するまでモデルと履歴を変更しない。確定は Undo 1 回とし、構造再描画後は同じ入力のフォーカス・選択範囲・スクロールを復元する。削除された入力を別の入力で代用しない。
- Shift+ノードヘッダークリックで複数選択。グループ移動は全対象が編集可能な場合のみ適用し、一部だけ動かさない。
- Curve のハンドルは corner / smooth / symmetric。Remap の Position / Handle A / Handle B はそれぞれ直接値・式・Vector2 接続・ロックを持つ。
- Undo / Redo、ドキュメント置換で一時的な描画・配線・Remap 一括選択をクリアする。新規／別ドキュメント／コンポジション切替では適切にグラフ表示位置を戻し、通常編集は視点を保つ。
- ノード幅は 220〜550 px、折りたたみ入力の中心間隔は 24 px。幅・座標・折りたたみは JSON に保持するが形状評価キャッシュを無効化しない。
- 端ドラッグの自動パンは 64 px の領域で開始し、速度上限は軸ごと 720 px/秒。ポインターがパネル外へ出ても追跡し、終了・中断時に停止する。

## 6. ガイドとレイアウトグリッド

手動ガイドは水平・垂直、数値位置、ドラッグ、個別ロック、全体表示を持つ。非表示ガイドは吸着対象から外し、ロックされた表示中ガイドは吸着対象に残す。通常レイヤーをガイドレイヤーにすると編集可能な参照図形として残るが、作品出力から常に除外する。

吸着はズームにかかわらず画面上 6 px、Alt で一時解除。可視ガイド、アートボードの端・中心を背景グリッドより優先する。複数生成ノードの移動は一つの平行移動として扱い、間隔を保つ。ノードグラフのカードや配線はキャンバスガイドに吸着しない。

Layout grid は列数・行数（各 1〜40）、左右上下のマージン、ガターからガイドを生成する。プレビューは編集履歴を増やさず、作成・更新・削除は生成分だけを一括変更し手動ガイドを残す。手動分との合計上限は 200 本。生成線は固定座標なので、**アートボードのサイズ変更後は Update layout を明示的に実行する**。自動配置やレスポンシブレイアウトではない。ガイド、グリッド、選択表示は SVG / PNG に含めない。

## 7. テキストとフォント

ローカルの静的 TTF / OTF を読み込み、日本語・複数行・横書き・縦書き・字間・行間／列間を扱う。SVG はテキストをアウトラインで出力する。JSON には再編集用のフォントを埋め込む。

縦書きは右から左へ列を送り、対応フォントの縦用字形・メトリクスを利用する。複雑なシェーピングや自動フォントフォールバックを保証しない。欠落グリフのあるテキストは編集・JSON 保存できるが、エラーのある可視作品の SVG 出力は拒否する。

手動ファイル指定では TTC / OTC は対象外（Windows 自動一覧の静的 face 読込は第 12 節）。WOFF / WOFF2、可変フォント、CFF2、カラー／ビットマップフォントは対象外。fsType の restricted、preview/print-only、bitmap-only は拒否する。技術的に読み込めても、埋め込み・共有の権利を保証するわけではない。利用者はライセンスを確認する。

上限は 1 フォント 20 MB、8 フォント、合計 32 MB。読み込み取消、不正ファイル、ロック、非同期読み込み中の別編集では現状を保つ。詳細は [typography.md](typography.md)。

## 8. ファイルと画像

- JSON: 図形・ノード・接続・ガイド・埋め込みフォント／画像を保持する。UTF-8 全体で 50 MB 上限。未知のバージョンや不正モデルは拒否する。
- SVG: アートボード全体、背景透明、非表示／ガイドレイヤーを除外。任意の SVG を忠実に読み込むのではなく、安全なベクター部分集合だけを受け入れる。CSS、外部参照、スクリプト、グラデーション、フィルター、マスク等は拒否する。
- PNG: SVG と同じ作品を透明背景で 0.5 / 1 / 2 / 4 倍出力。各辺 8192 px、合計 16 メガピクセルまで。
- ローカル PNG / JPEG: Image と Image Output のコンポジションへ読み込む。デコード後 PNG に正規化し、JSON に埋め込む。位置は左上、サイズは幅・高さ。Path と別型で、自動トレースや Boolean はしない。
- 画像の回転、効果、クリッピングはこの段階の対象外。画像入力は 1 枚 12 MB、8192 px/辺、16 メガピクセル、埋め込み合計 24 MB / 32 メガピクセルまで。
- **画像入りの書き出し SVG は、このアプリには再インポートできない。編集再開には JSON を使う。** 通常の SVG ビューアーでの表示や PNG 出力とは別の制限である。
- Open / Import による未保存作品の置換は確認し、取消や読み込み失敗で現状を失わない。画像・フォントの非同期読み込み結果が新しい編集を上書きしない。

### 8.1 評価・保存・安全性の境界

- 評価はコンポジション内でメモ化し、変更された入力とその下流だけを再計算する。返却値は防御的にコピーし、Paper.js のオブジェクトを公開データ形式へ漏らさない。
- グラフ評価深度は 256、数式は 4096 文字。接続元は同じコンポジションに限り、ノード・頂点・差分の ID 重複、不正型、欠落参照を検証する。
- 履歴は最大 100 回。フォントの不変バイト列は共有し、履歴内の異なるフォントが 96 MB を超えた場合も古い履歴を落とす。例外を投げた変更はトランザクション全体を戻す。
- SVG 入力は 10 MB、出力は埋め込み画像の重複分も含め 50 MB。Text は 10000 UTF-16 コード単位、生成パスコマンドは 500000 の上限を持つ。
- 可視の通常作品レイヤーに評価エラーがあれば出力全体を停止し、正常な部分だけを黙って出力しない。非表示／ガイドレイヤーのエラーは作品出力を妨げない。
- ブラウザーと native 保存を storage adapter で分離し、native は利用者が選んだ宛先へ段階的／atomic 保存を行う。フロントエンドへ一般的なファイルシステム権限を公開しない。保存の連打を抑制し、取消はモデルを変えない。実際の Windows 保存耐久性は別の受入項目。
- headless CLI は同じ JSON・フォント・評価・SVG 出力を使い、既存出力ファイルへの上書きを拒否する。ブラウザー限定の画像ピクセルデコーダーと、DOM 非依存の画像構造検証は区別する。
- CSP を緩和せず Paper core を利用する。Expression は +、-、\*、/、%、括弧、pi/e、sin/cos/tan/abs/sqrt/min/max/round の許可範囲で扱い、任意コードや変数参照はしない。

## 9. 実装・検証状況と受入条件

### この文書作成時の状態

- 基本編集、型付き接続、Remap、折りたたみ、日本語／縦書きなどは実装済みで、Windows Chrome と Tauri / NSIS の合格証跡がある。例: [日本語テキスト CI 38507757994](https://github.com/46slv/Nect-SVG/actions/runs/38507757994)、対象 `3faa5d5f82a62742bdc31e2e9f2bf50a955e9ea6`。
- ガイド、レイアウト、画像、明示的 Fill / Stroke / Color、グラフナビゲーション、Separate / Math / Combine はソースに実装されている。
- Fill / Stroke の `2da61efe5b1fa19de3f3218859fc1c328dc2e1b9` は [CI 38553667313](https://github.com/46slv/Nect-SVG/actions/runs/38553667313) で 74 テスト、実 Chrome、PNG / JSON / SVG、NSIS が合格。グラフナビゲーション `1bb084012e2ae3599a4c49f83bcfde4143abfa9f` は [CI 38552605624](https://github.com/46slv/Nect-SVG/actions/runs/38552605624)、Color `3b058e6ee3c44c8731d6201671a03f2fb0c42238` は [CI 38550715450](https://github.com/46slv/Nect-SVG/actions/runs/38550715450) が全段階合格。
- 確認済みリモート実装チェックポイントは [17b8bd6](https://github.com/46slv/Nect-SVG/commit/17b8bd6)。実装担当の確認ではローカルの formatting、79 テスト、production build が合格。
- このチェックポイントの [Windows CI 38555346804](https://github.com/46slv/Nect-SVG/actions/runs/38555346804) は、実装担当の最新確認で実 Chrome の全スイートが合格。Separate の X / Y ドラッグ・折りたたみ・メニュー、Math の入力・履歴・再読込・出力を含む。NSIS packaging と証跡保存も完了し、このチェックポイントの CI 全体が合格。
- Vector Math とポインター追従ワイヤーは本書を追加したチェックポイントで実装済み。ローカルの 82 unit / synthetic DOM テスト、formatting、production build を検証し、実 Chrome と NSIS はこの新しいコミットの CI で別途確認する。
- native WebView2 の実操作、ネイティブファイルダイアログ、保存・終了中断の受入は未完了。Chrome 合格とインストーラー生成だけで Windows 製品完成とはしない。

### 継続して満たす受入条件

1. 型違い、循環、ロック違反、不正ファイルで既存データ・接続を壊さない。
2. 直接編集、接続、Expression、切断復元、Undo / Redo、JSON 再読込が同じ作品へ収束する。
3. ペイントの塗り・線・alpha、テキスト輪郭、画像、レイヤー順が同じ出力シーンに反映され、ガイドは含まれない。
4. 非同期読み込み、キャンセル、連続操作、ドラッグ中断で遅延結果や残った操作が再発しない。
5. unit / synthetic DOM に加え実 Chrome で対象操作を検証し、native Windows の受入は別に記録する。
6. `npm run check`、`npm run test:e2e`、Windows packaging を該当コミットに結び付け、未実行・失敗・合格を区別する。

## 10. 保留・別途判断

- 承認済みの残作業: 現チェックポイントの Vector Math・配線プレビューの実 Chrome / NSIS 検証と、上記 native Windows の受入。
- 別途判断: Nect 統合方式、クラウド実行、グラデーション、マクロ、テンプレート、より広い SVG 対応、ミニマップ、ワイヤー上へのノード挿入、Lazy Connect。将来案を現在の承認済み実装範囲へ自動追加しない。
- 公開サービス化には入力隔離・CPU／メモリー制限等の追加対策が必要。現行のローカル編集エンジンを、そのまま安全なマルチテナントサービスとは扱わない。
- 本流マージ、公開リリース、署名、デプロイは本仕様書の完成や CI 合格とは別の判断。

## 11. 根拠と詳細資料

実装リポジトリ: [46slv/Nect-SVG](https://github.com/46slv/Nect-SVG)。以下のリンクは実装担当がリモート存在を確認した `17b8bd6` 時点の資料・ソースに固定している。

- [README](https://github.com/46slv/Nect-SVG/blob/17b8bd6/README.md): 起動、操作概要、Windows と headless 境界
- [architecture.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/architecture.md): 型、schema 2、ペイント移行、Math と sourcePort
- [interaction.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/interaction.md): 操作、ガイド、レイアウトグリッド
- [typography.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/typography.md): フォント形式、縦書き、ライセンス制約
- [image-export.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/image-export.md): 画像、PNG、SVG 再読込制限
- [verification.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/verification.md) / [windows-acceptance.md](https://github.com/46slv/Nect-SVG/blob/17b8bd6/docs/windows-acceptance.md): 過去の合格証跡と native Windows の残条件
- [src/core.js](https://github.com/46slv/Nect-SVG/blob/17b8bd6/src/core.js): 型、演算、評価、移行、JSON 検証
- [tests/math.test.js](https://github.com/46slv/Nect-SVG/blob/17b8bd6/tests/math.test.js) / [tests/math.e2e.js](https://github.com/46slv/Nect-SVG/blob/17b8bd6/tests/math.e2e.js): 数値・XY の回帰条件と実ブラウザー検証

分野別資料には導入時点の schemaVersion 1 表記が残る箇所がある。現在の新規保存形式は schemaVersion 2 であり、本文第 3.3 節と現在の core が優先する。過去 CI の合格は後続変更の合格を意味しない。

## 12. Windows インストール済みフォント（2026-10-14 追加）

Text の Windows font から、標準システム／ユーザー Fonts フォルダー内のフォントを自動列挙して選ぶ。選んだ face だけを読み込み、静的 TTC/OTC は単独 SFNT に再構成して JSON に埋め込む。可変・カラー形式は理由付きで無効表示。ライセンス判定・日本語／縦書き・サイズ制限・失敗時の文書保全・Undo は既存の TTF/OTF 読込と共通。標準外配置の登録フォントは自動列挙対象外。ブラウザー版はファイル指定を継続する。詳細と検証境界は typography.md と windows-acceptance.md を参照。

## 13. 制作用要素: Geometry Repeater とテキストアンカー（2026-10-14）

今回の追加依頼に基づき、Nect の [product-direction.md](https://github.com/46slv/Nect/blob/main/docs/product-direction.md) の local repeater / radial design、および [r05-a-text-coverage.md](https://github.com/46slv/Nect/blob/main/docs/r05-a-text-coverage.md) と [r05-c-text-path-entry.md](https://github.com/46slv/Nect/blob/main/docs/r05-c-text-path-entry.md) の alignment / advance を、SVG-first の小さな制作単位へ適用した。これは Nect 全体、AE のペイントスタック、DirectWrite の段落レイアウトの完全移植ではない。

### Geometry Repeater

- Path → Path。既存形状を繰り返してから Fill / Stroke へ接続する。PaintedPath / Image は入力しない。個別コピーへの色・不透明度・スタイル配分やコピーの Boolean 結合は行わない。
- Linear は step（XY）×コピー番号で移動。Radial は元の形状と Bézier ハンドルを center の周囲で回転する。半径は元形状と center の距離から決まり、円周への自動整列ではない。
- Count は元に相当する最初のコピーを含む整数 1〜256。Radial の最初のコピーにも startAngle を適用する。
- Radial-fit の angle は -360〜360° の総弧。部分弧は count−1 で割り両端を含め、±360° は count で割り重複した終点を作らない。count=1 は startAngle の一つだけ。0° は重なるコピーとなる。
- Radial-step の angle はコピーごとの角度差。負の角度も使用できる。Linear と Radial の非表示パラメーターは保存し、モード切替で接続・値・式を破棄しない。
- count / step / center / startAngle / angle は既存の型付き入力、直接値、Expression、ロックに従う。出力は最大 10000 輪郭・100000 点。ネストした Repeater も各出力の上限で拒否し、非有限座標はエラー。
- 各コピーに一意な ID を生成する。下流 Remap は反復結果の変更時に既存差分を保持して停止し、明示的 Rebind を必要とする。元の形状は変更しない。

### テキストアンカーと Kerning

- Text の Alignment は start / center / end。横書きは各行の X、縦書きは各列の Y を、position に対する進行方向のアンカーとして扱う。横書きの baseline、縦書きの列の X と列間隔は変えない。
- 文字の見た目の外接矩形ではなく、同じ glyph run の advance と文字間隔から測る。空白の advance を含み、最後の glyph の後ろの余分な letterSpacing を含めない。空行は advance 0。負の字間で advance が負になる場合も符号付きの値で配置する。
- Kerning は横書きの既存の既定動作（ON）を明示的に切り替える UI。今回初めてカーニングを実装したという意味ではない。選択フォントの対応情報を使い、値を捏造しない。縦書きでは変更しない。
- 古い JSON の省略値は alignment=start、kerning=true として従来の描画を維持する。SVG は引き続き輪郭で出力し、JSON に編集用の設定を保存する。
- 幅固定のテキストフレーム、折り返し、禁則、均等割付、文字別属性、任意の複雑なシェーピング、フォント自動代替は今回含めない。

### 検証と次の候補

新規 unit / synthetic DOM テストは線形・放射・負角度・1 コピー・上限・有限性・型・キャッシュ・JSON・Undo / Redo・ロック・文字 advance を対象とする。実 Chrome テストは両 UI、履歴、不正 count の保全、JSON / SVG / PNG 保存を `workflow-creation.*` に出力する。ローカル Chromium 起動は実行環境の socket 制限で停止したため、実ブラウザーと Windows パッケージの合格は、この変更を含む CI の実行結果が出てから記録する。

Polygon / Star は第 15 節で実装。Stroke の cap / join / dash と Join Geometry は第 14 節で実装。タイポグラフィの次候補は明確なフレーム幅と折り返し・禁則。これらは今回の実装済み機能と混同しない。Nect 統合、マクロ、クラウド、本流マージ、公開リリースは引き続き別判断。

## 14. Stroke の線表現と Join Geometry（追加制作要素）

### Stroke style

- Line cap: butt / round / square。Line join: miter / round / bevel。
- miterLimit は 1〜10000 の比率、dashOffset は -100000〜100000 px。既存の Scalar 接続・Expression・ロックに従う。直接値の範囲外入力は元の値を保つ。
- Dash / gap は空欄または none で実線。非負の px 数値を空白／カンマで区切り、最大 32 項、各 0〜100000。奇数項は SVG の規則で配列を二度繰り返す。全項 0 は実線。負数、非有限数、パーセント、未対応単位は拒否する。
- 古い Stroke は butt / miter / miterLimit 4 / 実線 / offset 0 として同じ見た目を保持する。
- SVG 出力と入力は cap / join / miterlimit / dasharray / dashoffset を共有し、入力では親からの継承と子の上書きを保つ。未対応の値を黙って捨てない。塗りと線の alpha は引き続き独立。
- 対応範囲は Nect が参照する AE の基本線表現を SVG に適用したもの。[Adobe の shape attributes / paint operations](https://helpx.adobe.com/after-effects/desktop/drawing-painting-and-paths/shapes-and-shape-attributes/shape-attributes-paint-operations-path.html) を仕様根拠とし、ブラシや可変幅 Stroke は含めない。

### Join Geometry

利用者の「二つの Shape を同じまとまりとして扱いたい」という追加依頼に対応する。Boolean は輪郭を計算して変える操作、Join は形状を保持して束ねる操作として区別する。

- A / B の Path を受け Path を返す。Fill / Stroke より前に置き、後続の Transform、Remap、Repeater、共通の Fill / Stroke へまとめて渡す。PaintedPath、Image、異なるレイヤーの出力は束ねない。
- 元の輪郭、穴、開いた線を保持し、左右の入力を独立した形状グループとして扱う。重なった輪郭を溶接したり切り取ったりしない。
- SVG はグループごとの path を出力する。逆向きの輪郭同士の重なりが相殺されず、各入力の穴も保持する。共通 Fill が半透明の場合、重なりは独立描画によって濃くなる。重なりを一つの面として塗る場合は Boolean Union を使用する。
- Transform / Remap はグループを保持し、Repeater は各コピーで独立したグループを作る。通常のグループを持たない既存 Path / Repeater の描画は変更しない。
- Join を Boolean へ渡す場合、Boolean の各入力内にある独立グループを先に Union して面の集合にしてから指定演算を行う。Join 自体の保存形状は変更しない。開いた線を含む Boolean は従来どおり拒否する。
- 最大 256 独立グループ、10000 輪郭、100000 点。Join とグループを持つ Repeater の双方に上限を適用する。ID と fingerprint は長い上流 ID やネストで増大しない固定長 SHA-256 を用い、下流 Remap の保存と再読込を保つ。
- SVG の再読み込みでは、本アプリのタグ付きグループで同じペイントを持つ path 群を、深さを抑えた Join ツリーの一つのコンポジションへ戻す（最大 256 グループ）。元の Join 接続、共有 Transform、コピー構成をそのまま編集再開する場合は JSON を使う。異なるペイントを持つ一般 SVG は従来どおり個別レイヤーへ読み込む。

### 受入

unit / synthetic DOM は SVG の継承・再読込、旧値、範囲、型、履歴、ロック、穴、逆向きの重なり、Transform / Remap / Repeater と Boolean の組合せを検査する。実 Chrome の `join-stroke.e2e.js` は重なりの alpha、穴、丸い線端、破線の空隙を PNG ピクセルで検査し、`workflow-join-stroke` の JSON / SVG / PNG / 編集画面を保存する。ソース実装と実 Chrome / NSIS の CI 合格は別に確認する。

## 15. Polygon / Star generators

Nect の product-direction の「Instantiate → parameterize」に挙げられた Polygon / Star を、既存の型付き Path ジェネレーターとして実装する。以下は Nect-SVG で明示した具体的な既定値と幾何規則。

- Polygon: center=[350,250]、sides=6、radius=120、rotation=0。
- Star: center=[350,250]、points=5、outerRadius=120、innerRadius=60、rotation=0。points は外側頂点の数で、輪郭の頂点数はその 2 倍。
- Count は整数 3〜256。半径は有限の正値、最大 100000 px。Star は innerRadius ≤ outerRadius。範囲外・小数 count を丸めずエラーとし、直接入力は履歴トランザクションで元の値を保つ。Expression と接続の解決後も同じ検証を行う。
- 画面座標（Y 下向き）で、最初の外側頂点は center の真上。rotation は度単位で時計回り。Polygon の頂点 i は角度 rotation−90+i×360/sides、Star は rotation−90+i×180/points に外・内半径を交互に適用。角度は計算前に 360° で剰余を取り、非常に大きな有限回転でも三角関数を安全に評価する。
- 輪郭は閉じた直線辺、相対ハンドルはゼロ。radius=0 の退化形状や負の半径は作らない。inner=outer は 2×points 頂点の正多角形となる。
- Add node と左ツールバーから追加し、center のキャンバス移動・スナップ・ロック・接続・式・Undo / Redo は既存操作に従う。center がロック／接続／式で駆動される場合はドラッグしない。
- 頂点 ID はジェネレーター ID、種類、count、頂点番号に結び付ける。center / 半径 / rotation の変更では同じ頂点への Remap を維持する。count 変更では元の差分を保存して停止し、別頂点へ黙って適用しない。元の count に戻すと同じ定義の頂点 ID が復元する。下流 Boolean / Join / Repeater の既存の不安定トポロジー規則は変えない。
- Boolean / Join Geometry / Geometry Repeater / Transform / Fill / Stroke への既存接続、JSON 保存再読込、SVG / 透過 PNG 書き出しに対応。新しい Transform 意味論、Position OUT、グラデーション、テキストフレームは含めない。
- 検証: polygon-star unit は正確な座標、型、キャッシュ、制限、式／入力、Remap、履歴、JSON と演算合成。polygon-star browser は追加、パラメーター変更、不正値保全、ドラッグ／ロック、保存と SVG / PNG ピクセルを検証する。実ブラウザー／Windows ビルド合格は対応 CI 結果で確認する。

## 16. 既存 Transform の Anchor と共有親

- Transform ノードを追加で別実装せず、既存ノードへ anchor: Vector2（既定 [0,0]）を追加。式は p′ = anchor + offset + R(rotation) × scale × (p − anchor)。anchor は入力パスと同じ座標系の拡縮・回転中心。offset は最後に加算する移動量であり、anchor の出力位置への置き換えではない。
- 旧 JSON は anchor=[0,0] を補い、従来の原点中心の結果を維持する。anchor は XY 入力、Vector2 接続、Expression、ロック、履歴、JSON に対応する。
- 複数の形／Text → Join Geometry → Transform → Fill / Stroke → Output が共有親の基本構成。子の位置やタイポグラフィ設定を変えず、まとめた結果を動かす。Transform を重ねると上流から順に合成する。輪郭・頂点・独立 paint group ID と入力 fingerprint を維持する。
- Transform を単独選択した場合、キャンバスドラッグは offset を変更してグループ全体を移動する。offset のロック／接続／式とレイヤーロックを尊重する。親と子を同時にドラッグして二重移動する操作は行わない。自動親ノード作成、クロスレイヤー親子関係、独立したシーンツリーは含めない。
- Anchor の変更は拡縮／回転済みの結果に影響する。見た目を固定してアンカーだけを移動する補償モードではない。
- examples/right-aligned-typography-group.json は同一右端アンカーで右揃えした見出しと副題を Join して共通 Transform に接続した編集可能な例。現在の例は visible Position reference により字形の見た目の右端を一致させる。旧ファイルの advance 基準は保持する。
- 検証は正確な pivot 座標・ハンドル、ネスト順序、輪郭の穴、入力 ID、古い JSON、キャッシュ、式／接続、Undo / Redo、DOM の共有移動／ロック／子不変性。実 Chrome テストは上記例と JSON / SVG / PNG 保存を検査し、Windows CI の結果で合格を判断する。

### Per-object Position reference

Objects with Position support choosing the point represented by that coordinate. Text reuses alignment plus visible/advance bounds and a cross-axis reference (see typography). Circle, Ellipse, Rectangle, Polygon, Star, and Image expose `positionReference`: `origin`, or `{left|center|right}-{top|middle|bottom}`. Shape bounds exclude stroke; Image uses its full rectangle including transparent pixels. Changing reference moves geometry while retaining Position; changing dimensions keeps the chosen reference fixed. The serialized shape parameter remains `center` for existing sockets, expressions and saved files, while its displayed label is Position.

Omitted references preserve legacy construction origin exactly, including asymmetric polygons/stars and top-left images. An explicit bounds center can differ from a radial shape's construction center. Curve, Imported Path and compound operators do not receive artificial Position controls. Transform Anchor is unchanged, and Position output sockets are outside this change. References participate in cache invalidation, validation, JSON, Undo/Redo, driven inputs, canvas dragging and snapping.

## 17. Text Position OUT（実験実装、実 Chrome 検証待ち）

Text は既存の Path 出力を保ち、Vector2 の Position 出力を追加する。Position は接続元 → Expression → 直接値の優先順位で評価した入力座標であり、その Text に保存された Position reference の座標を表す。フォント・文字列・参照設定でアウトラインが変わっても、Position 自体を別の点へ読み替えない。

- Position OUT は Text 生成時点の座標。下流 Transform、別の Transform 枝、キャンバスのズーム・パンは含めない。共通の最終移動は Join Geometry → Transform で行う。
- XY は Text.Position → 別の Text.Position。X のみは Separate Vector.X → Combine Vector.X とし、Y は Combine の直接値・式・別ソースで独立させる。間隔は Scalar Math または Vector Math の Add で明示する。
- 編集・スナップの持ち主は接続元。追従先の接続中 Position をドラッグして上流を書き換えず、自動オフセットも追加しない。ロック・式駆動の既存制限を維持する。
- Path は既存どおり sourcePort を省略し、Position は `sourcePort: "position"`。安定した source ID を使い、名前変更で参照を切らない。削除で通常接続と同じく切断し、保存済みの式／値に戻る。Undo / Redo で接続を復元する。単一ノード複製は外部の参照元を保持し、元ノードの追従先を複製へ付け替えない。
- schemaVersion は 2 を維持し、旧 Text Path 接続の移行は不要。未知ポート、型不一致、自己・間接循環を拒否する。旧版で新しい Position 接続を読む互換性は保証しない。
- Position は独立した評価・キャッシュを持ち、フォントが未読込でも有効な座標は取り出せる。Path のフォント／アウトラインエラーを隠すことはなく、Path を必要とする描画では従来どおり診断する。
- `examples/text-position-reuse.json` はマスター、XY 追従、独立 Y の X 追従、Vector Math オフセットと共通 Join → Transform を含む試用例。マスターの Position、Combine の Y、Vector Math の B、共有 Transform の offset を順に編集して比較できる。

型・優先順位・キャッシュ・Transform 空間・循環・JSON・履歴・既存 Path と、DOM のメニュー／配線／取消／スナップ所有権／削除／複製をテストする。実 Chrome の同操作と JSON/SVG/PNG 出力は `tests/text-position-output.e2e.js` に用意し、Windows CI の対応コミットで別途実行する。ローカル環境の Chromium socket 制限は解消していないため、この実装時点で Chrome／NSIS 合格とはしない。

[Position 再利用の実験候補](position-reuse-candidates.md) に4案を維持する。Text Position OUT に続き、[Nullの位置専用コントローラー](null-position.md)も試作した。Nullは選択時のみ十字ハンドルを表示し、既存スナップでPositionを編集して単一Vector2 OUTを出す。マーカーはSVG/PNGへ出力せず、接続・数式・ロック中の値はキャンバスから変更しない。続いて[明示ONのVectorキャンバスハンドル](vector-position.md)を試作した。Vectorの型・評価・Value XYを維持し、任意の位置用途だけにハンドルを表示する。続いて[同一レイヤー Vector2 Reference](vector-reference.md)も試作した。クロスレイヤー参照、ポスト Transform 点は含めない。キャンバス拡縮・回転は後続の既存 Transform ハンドル試作に記載する。試用後に採否・併存・統合を判断する。

## 18. Vector の明示的なキャンバス位置ハンドル

既存 Vector に保存可能な `canvasPositionHandle: Boolean` を追加する。既定・省略時は false。カードと Inspector の **Canvas position handle** を明示 ON にした場合だけ、選択時に **Vector XY** と示した菱形を表示する。方向・サイズ・オフセット用の Vector を自動で位置と解釈しない。

- Value XY と Vector2 出力は従来のまま。表示設定の変更で評価結果・配線・数学演算は変わらない。型違いの表示設定と Vector 以外への設定は読込時に拒否する。
- Null と座標変換・6画面pxスナップ・Alt・drag・取消・履歴を共用する。編集元は自身の params.value のみで、下流 Transform 前の座標。空白クリックでは動かず、接続・数式・ロック時は評価値の読み取り専用マーカーになる。
- 1 gesture = 1 Undo。クリックの微小揺れ・元座標へ戻る操作は精度と履歴を保ち、Escape / pointercancel / lost capture / blur は全変更を戻す。Space / middle pan は優先し、数値の未確定入力は独立して確定する。
- 表示設定は保存・再読込・複製・Undo/Redoで保持する。SVG/PNGにはマーカーを含めない。`examples/vector-position-reuse.json` と Null 版は同じレイアウトを使い、専用 Position と汎用 Vector を比較できる。
- unit/DOM と実 Chrome 用テストを追加し全体suiteへ含める。ソース／ローカル検証と、対応コミットの実 Chrome・Windows packageの合格は別に確認する。詳しい操作と受入範囲は [Vector canvas position handle](vector-position.md)。

## 23. 既存 Transform の等比拡縮・回転ハンドル

- 既存 Transform の単独選択時、Anchor + Offset の固定 pivot、Scale の四角、Rotation の丸を表示する。Scale は既存 Scalar の等比値を維持し、縦横別・複数選択・新 Transform 挿入は行わない。
- 「Selected Transform output」と明示した選択ノード自身の評価段階を編集する。下流の Transform／Boolean 等を逆算しない。最終表示と異なる場合も、最終境界のハンドルと偽装しない。
- 既存 anchor／offset、子の位置、文字設定・文字単位offsetを変えず、対象の scale または rotation のみ更新。Shift で回転を15°刻みにスナップ。負scaleは保持し、ゼロ／極小からも操作できる。
- 接続／式／ロック中の対象パラメーターは読取専用。1gesture=1Undo、全取消経路の復元、クリックと往復の精度保持、pan優先、zoom座標変換、数値draft先行確定に対応する。
- JSON は既存モデル、SVG／PNG は作品のみ。例は [transform-canvas-handles.json](../examples/transform-canvas-handles.json)、詳細と検証範囲は [Transformハンドル仕様](transform-canvas-handles.md)。Chrome／NSISは対象commitのCIで別確認する。

### Other-layer artwork alignment

Implemented: opt-in **Snap artwork** adds other visible ordinary layers’ final evaluated shape/text/image edges and centers to existing translation snapping. The whole active layer and hidden/error/empty/suspended outputs are excluded; locked visible references remain usable. Snapshot bounds reuse prevents extra per-move evaluation. No same-layer all-node snapping, glyph target search, equal-spacing inference or rotated-edge inference is included. [Detailed behavior](artwork-bounds-snapping.md).

## Same-layer Vector2 Reference experiment

Reference exposes one non-rendering Vector2 output selected by stable same-layer node ID and public port ID. Text Position, Null, Vector and other Vector2 outputs are supported; names are display labels only. Normal wires and Reference share dependency/cycle validation and cache invalidation. An unset or deleted target produces an explicit diagnostic and cannot supply zero or stale fallback values. Rename, delete/Undo, internal-vs-external duplicate remapping, typed operation changes and save/load/import are covered. A selected source group can be duplicated as one Undo step; edited Path Remap + source copies are atomically refused until point-provenance remapping exists. Cross-layer references, property-string evaluation and post-Transform coordinate inference are excluded. See [full contract](vector-reference.md) and [ordinary-wire comparison sample](../examples/vector-reference-reuse.json).

## 文字単位の回転・等比拡縮

既存Character positionモードの小型欄とInspectorへRotate ° / Scale ×を追加。stable character IDに形状調整を保存し、normal layout後のadvance-cell中心をpivotとして回転・等比scale、その後XYを適用する。縦Latinの既存90°回転は局所形状調整より先。文字advance、他文字、Text Position/Position OUT、fontSizeとpaint groupingを変更しない。複数選択は各文字自身のpivotで同じ絶対値を適用し、他propertyを保持する。Reset XY / Reset shape / 全調整resetを区別する。

旧XY record v1/schema3を読み続け、初回非identity形状調整だけrecord v2/schema4へ更新。回転±36000°、scale 0.01–100。未検証文字編集・IMEのsuspendと最終Output出自Affineを継承し、singular/unsupported routeはcanvas編集のみ拒否する。新規プロジェクトの既定は引き続きschema2。操作・pivot数式・互換性・受入は[文字形状仕様](character-transform.md)、作例は[character-transform.json](../examples/character-transform.json)。実Chrome/Windows packageは対応commitで別確認し、native IME合格とはみなさない。

## Linear Gradient Fill（2 点の線形グラデーション）

Path / PaintedPath → Linear Gradient Fill → PaintedPath。start / end はアートボード座標 px の Vector2、startColor / endColor は既存の Color（HEX + alpha）。直接値・接続・切断時 fallback・ロック・履歴・JSON を保持する。形状操作はペイント前に置き、Repeater の全コピーで一つの空間的な色変化を共有する。塗りだけを置換し、線・形状・文字の識別情報を維持する。Canvas / SVG / 透過 PNG は同じ描画経路を使う。完全なグラフの再編集は JSON を使用する。自分で書き出した 2-stop / userSpaceOnUse / pad / sRGB の SVG は、安全なローカル定義のみを検証して編集可能なパスと塗りノードとして再読込できる。元の手続きグラフやアウトライン化前の編集可能なテキストは復元しない。複数 stop、gradient stroke、canvas endpoint handle は含めない。円形の Radial Gradient Fill は以下の独立した限定仕様で扱う。[詳しい仕様と検証](linear-gradient-fill.md)。

## Radial Gradient Fill（同心円のグラデーション）

Path / PaintedPath → Radial Gradient Fill → PaintedPath。center はアートボード座標 px の Vector2（各成分 ±100000）、radius は Scalar（0.0001〜100000 px）、startColor / endColor は HEX + alpha の Color。2 stop を 0 / 1 に固定し、userSpaceOnUse / pad / sRGB と同心の fx=cx / fy=cy / fr=0 を明示する。中心・半径の表示は有効な最小値を丸めず保持する。直接値・接続・式・fallback・ロック・履歴・JSON に対応し、形状と独立した線を維持する。

Canvas / SVG / 透過 PNG は同じ描画経路を使い、同一レイヤーのグループは一つの空間的な円を共有する。自分で書き出した限定 SVG は塗りとパスを編集可能な状態に再読込できる。元の手続きグラフ・テキストは JSON を使用する。既存の linear import、外部参照拒否、名前空間・資源上限と一括拒否を維持する。楕円変換・焦点移動・追加 stop・グラデーション線・perceptual interpolation は含めない。Illustrator での実機比較や、Nect ネイティブへの SVG 直接互換性を主張しない。[詳細・資料・検証](radial-gradient-fill.md)。
