<?php
/**
 * Trang cài đặt: Cài đặt > Thử lens.
 */

defined( 'ABSPATH' ) || exit;

class Lens_TryOn_Settings {

	const OPTION = 'lens_tryon_settings';

	public static function defaults() {
		return array(
			'button_text'     => 'Thử lens trực tiếp',
			'button_position' => 'after_add_to_cart',
			'accent'          => '#d6336c',
			'related_scope'   => 'category',
			'related_count'   => 8,
			'iris_mm'         => '11.8',
			'max_scale'       => '1.12',
			'watermark'       => get_bloginfo( 'name' ),
			'privacy_note'    => 'Xử lý 100% trên thiết bị – không lưu, không gửi hình ảnh',
			'vision_url'      => '',
			'wasm_url'        => '',
			'model_url'       => '',
		);
	}

	public static function get( $key = null ) {
		$opts = wp_parse_args( (array) get_option( self::OPTION, array() ), self::defaults() );
		if ( null === $key ) {
			return $opts;
		}
		return isset( $opts[ $key ] ) ? $opts[ $key ] : null;
	}

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	public static function menu() {
		add_options_page( 'Thử lens', 'Thử lens', 'manage_options', 'lens-tryon', array( __CLASS__, 'page' ) );
	}

	public static function register() {
		register_setting(
			'lens_tryon',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
			)
		);
	}

	public static function sanitize( $in ) {
		$d   = self::defaults();
		$in  = is_array( $in ) ? $in : array();
		$out = array();

		$out['button_text']     = isset( $in['button_text'] ) ? sanitize_text_field( $in['button_text'] ) : $d['button_text'];
		$positions              = array( 'after_add_to_cart', 'before_add_to_cart', 'after_summary', 'manual' );
		$out['button_position'] = isset( $in['button_position'] ) && in_array( $in['button_position'], $positions, true ) ? $in['button_position'] : $d['button_position'];
		$accent                 = isset( $in['accent'] ) ? sanitize_hex_color( $in['accent'] ) : '';
		$out['accent']          = $accent ? $accent : $d['accent'];
		$scopes                 = array( 'category', 'all', 'none' );
		$out['related_scope']   = isset( $in['related_scope'] ) && in_array( $in['related_scope'], $scopes, true ) ? $in['related_scope'] : $d['related_scope'];
		$out['related_count']   = isset( $in['related_count'] ) ? max( 0, min( 30, absint( $in['related_count'] ) ) ) : $d['related_count'];
		$out['iris_mm']         = isset( $in['iris_mm'] ) ? (string) max( 10, min( 13.5, (float) $in['iris_mm'] ) ) : $d['iris_mm'];
		$out['max_scale']       = isset( $in['max_scale'] ) ? (string) max( 1, min( 1.3, (float) $in['max_scale'] ) ) : $d['max_scale'];
		$out['watermark']       = isset( $in['watermark'] ) ? sanitize_text_field( $in['watermark'] ) : '';
		$out['privacy_note']    = isset( $in['privacy_note'] ) ? sanitize_text_field( $in['privacy_note'] ) : $d['privacy_note'];
		foreach ( array( 'vision_url', 'wasm_url', 'model_url' ) as $k ) {
			$out[ $k ] = isset( $in[ $k ] ) ? esc_url_raw( trim( $in[ $k ] ) ) : '';
		}
		return $out;
	}

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o = self::get();
		$n = self::OPTION;
		?>
		<div class="wrap">
			<h1>Thử lens trực tiếp</h1>
			<p>Thêm ảnh lens PNG (nền trong suốt) trong trang sửa sản phẩm → tab <strong>Thử lens</strong> (hoặc trong từng biến thể màu).
				Nút thử sẽ tự hiện trên trang sản phẩm có ảnh. Có thể đặt nút ở bất kỳ đâu bằng shortcode <code>[lens_tryon_button]</code> hoặc <code>[lens_tryon_button product_id="123"]</code>.</p>
			<form method="post" action="options.php">
				<?php settings_fields( 'lens_tryon' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="lto-bt">Chữ trên nút</label></th>
						<td><input id="lto-bt" class="regular-text" name="<?php echo esc_attr( $n ); ?>[button_text]" value="<?php echo esc_attr( $o['button_text'] ); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-bp">Vị trí nút</label></th>
						<td>
							<select id="lto-bp" name="<?php echo esc_attr( $n ); ?>[button_position]">
								<?php
								$pos = array(
									'after_add_to_cart'  => 'Dưới nút Thêm vào giỏ',
									'before_add_to_cart' => 'Trên form Thêm vào giỏ',
									'after_summary'      => 'Cuối phần mô tả ngắn',
									'manual'             => 'Không tự chèn (dùng shortcode)',
								);
								foreach ( $pos as $k => $label ) {
									printf( '<option value="%s"%s>%s</option>', esc_attr( $k ), selected( $o['button_position'], $k, false ), esc_html( $label ) );
								}
								?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-ac">Màu chủ đạo</label></th>
						<td><input id="lto-ac" type="color" name="<?php echo esc_attr( $n ); ?>[accent]" value="<?php echo esc_attr( $o['accent'] ); ?>"></td>
					</tr>
					<tr>
						<th scope="row">Mẫu lens khác trong giao diện thử</th>
						<td>
							<select name="<?php echo esc_attr( $n ); ?>[related_scope]">
								<option value="category" <?php selected( $o['related_scope'], 'category' ); ?>>Cùng danh mục</option>
								<option value="all" <?php selected( $o['related_scope'], 'all' ); ?>>Tất cả sản phẩm có ảnh thử</option>
								<option value="none" <?php selected( $o['related_scope'], 'none' ); ?>>Chỉ sản phẩm đang xem</option>
							</select>
							&nbsp; tối đa <input type="number" min="0" max="30" class="small-text" name="<?php echo esc_attr( $n ); ?>[related_count]" value="<?php echo esc_attr( $o['related_count'] ); ?>"> sản phẩm
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-iris">Đường kính mống mắt chuẩn (mm)</label></th>
						<td><input id="lto-iris" type="number" step="0.1" class="small-text" name="<?php echo esc_attr( $n ); ?>[iris_mm]" value="<?php echo esc_attr( $o['iris_mm'] ); ?>">
							<p class="description">Dùng để quy đổi đường kính đồ hoạ (GDIA) của lens ra kích thước trên mắt. Mặc định 11.8.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-ms">Tỉ lệ lens tối đa so với mống mắt</label></th>
						<td><input id="lto-ms" type="number" step="0.01" class="small-text" name="<?php echo esc_attr( $n ); ?>[max_scale]" value="<?php echo esc_attr( $o['max_scale'] ); ?>">
							<p class="description">1.00 = lens không bao giờ vượt viền mống mắt. Lens giãn tròng thật thường 1.05–1.15.</p></td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-wm">Chữ trên ảnh chụp</label></th>
						<td><input id="lto-wm" class="regular-text" name="<?php echo esc_attr( $n ); ?>[watermark]" value="<?php echo esc_attr( $o['watermark'] ); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="lto-pn">Ghi chú quyền riêng tư</label></th>
						<td><input id="lto-pn" class="large-text" name="<?php echo esc_attr( $n ); ?>[privacy_note]" value="<?php echo esc_attr( $o['privacy_note'] ); ?>"></td>
					</tr>
				</table>

				<h2>Nâng cao: tự host bộ nhận diện khuôn mặt</h2>
				<p>Để trống để dùng CDN mặc định (jsDelivr + Google). Chỉ mô hình được tải về trình duyệt; không có hình ảnh nào được gửi đi.</p>
				<table class="form-table" role="presentation">
					<tr><th scope="row">vision_bundle.mjs</th><td><input class="large-text code" name="<?php echo esc_attr( $n ); ?>[vision_url]" value="<?php echo esc_attr( $o['vision_url'] ); ?>" placeholder="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"></td></tr>
					<tr><th scope="row">Thư mục wasm</th><td><input class="large-text code" name="<?php echo esc_attr( $n ); ?>[wasm_url]" value="<?php echo esc_attr( $o['wasm_url'] ); ?>" placeholder="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"></td></tr>
					<tr><th scope="row">face_landmarker.task</th><td><input class="large-text code" name="<?php echo esc_attr( $n ); ?>[model_url]" value="<?php echo esc_attr( $o['model_url'] ); ?>" placeholder="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"></td></tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
