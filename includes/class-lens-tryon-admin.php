<?php
/**
 * Trường quản trị: tab "Thử lens" trong sản phẩm + ảnh lens cho từng biến thể.
 */

defined( 'ABSPATH' ) || exit;

class Lens_TryOn_Admin {

	public static function init() {
		add_filter( 'woocommerce_product_data_tabs', array( __CLASS__, 'tab' ) );
		add_action( 'woocommerce_product_data_panels', array( __CLASS__, 'panel' ) );
		add_action( 'woocommerce_admin_process_product_object', array( __CLASS__, 'save_product' ) );
		add_action( 'woocommerce_product_after_variable_attributes', array( __CLASS__, 'variation_fields' ), 10, 3 );
		add_action( 'woocommerce_save_product_variation', array( __CLASS__, 'save_variation' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	public static function assets( $hook ) {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'product' !== $screen->post_type || ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}
		wp_enqueue_media();
		wp_enqueue_script( 'lens-tryon-admin', LENS_TRYON_URL . 'assets/js/admin.js', array( 'jquery' ), LENS_TRYON_VERSION, true );
		wp_add_inline_style(
			'woocommerce_admin_styles',
			'#lens_tryon_data .lto-img-field{display:flex;align-items:center;gap:10px}' .
			'.lto-img-preview{width:64px;height:64px;border-radius:50%;background:#eee url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27%3E%3Crect width=%278%27 height=%278%27 fill=%27%23ddd%27/%3E%3Crect x=%278%27 y=%278%27 width=%278%27 height=%278%27 fill=%27%23ddd%27/%3E%3C/svg%3E");object-fit:contain;border:1px solid #ccd0d4}' .
			'.lto-img-preview[src=""]{visibility:hidden}' .
			'.woocommerce_variation .lto-var-field{padding:6px 0;clear:both}'
		);
	}

	public static function tab( $tabs ) {
		$tabs['lens_tryon'] = array(
			'label'    => 'Thử lens',
			'target'   => 'lens_tryon_data',
			'class'    => array(),
			'priority' => 65,
		);
		return $tabs;
	}

	/**
	 * Ô chọn ảnh qua thư viện Media.
	 */
	public static function image_field( $name, $value, $id ) {
		$url = $value ? wp_get_attachment_image_url( $value, 'thumbnail' ) : '';
		?>
		<span class="lto-img-field">
			<img class="lto-img-preview" src="<?php echo esc_url( $url ); ?>" alt="">
			<input type="hidden" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" class="lto-img-input">
			<button type="button" class="button lto-img-pick">Chọn ảnh PNG</button>
			<button type="button" class="button-link lto-img-remove"<?php echo $value ? '' : ' style="display:none"'; ?>>Xoá</button>
		</span>
		<?php
	}

	public static function panel() {
		global $product_object;
		$p = $product_object;
		echo '<div id="lens_tryon_data" class="panel woocommerce_options_panel hidden">';
		echo '<div class="options_group">';
		echo '<p class="form-field"><label>Ảnh lens thử</label>';
		self::image_field( Lens_TryOn_Data::META_IMAGE, $p ? $p->get_meta( Lens_TryOn_Data::META_IMAGE ) : '', 'lens_tryon_image' );
		echo '<span class="description" style="display:block;clear:both;margin-top:6px">PNG vuông, nền trong suốt, lens tròn chiếm trọn khung, giữa (đồng tử) trong suốt. Sản phẩm có biến thể màu: đặt ảnh riêng trong từng biến thể (ảnh ở đây dùng làm mặc định).</span></p>';

		woocommerce_wp_text_input(
			array(
				'id'                => Lens_TryOn_Data::META_GDIA,
				'label'             => 'Đường kính đồ hoạ GDIA (mm)',
				'placeholder'       => 'VD: 13.2',
				'type'              => 'number',
				'custom_attributes' => array(
					'step' => '0.1',
					'min'  => '10',
					'max'  => '15.5',
				),
				'desc_tip'          => true,
				'description'       => 'Đường kính phần có màu của lens. Để trống = vừa khít mống mắt.',
				'value'             => $p ? $p->get_meta( Lens_TryOn_Data::META_GDIA ) : '',
			)
		);
		woocommerce_wp_text_input(
			array(
				'id'                => Lens_TryOn_Data::META_OPACITY,
				'label'             => 'Độ phủ màu (0.2–1)',
				'placeholder'       => '0.92',
				'type'              => 'number',
				'custom_attributes' => array(
					'step' => '0.01',
					'min'  => '0.2',
					'max'  => '1',
				),
				'desc_tip'          => true,
				'description'       => 'Lens tự nhiên (trong) ~0.7–0.85; lens màu đậm/tây ~0.9–1.',
				'value'             => $p ? $p->get_meta( Lens_TryOn_Data::META_OPACITY ) : '',
			)
		);
		woocommerce_wp_text_input(
			array(
				'id'                => Lens_TryOn_Data::META_PUPIL,
				'label'             => 'Vùng đồng tử giữ lại (0–0.6)',
				'placeholder'       => '0.28',
				'type'              => 'number',
				'custom_attributes' => array(
					'step' => '0.01',
					'min'  => '0',
					'max'  => '0.6',
				),
				'desc_tip'          => true,
				'description'       => 'Bán kính vùng giữa không tô màu, theo tỉ lệ bán kính mống mắt.',
				'value'             => $p ? $p->get_meta( Lens_TryOn_Data::META_PUPIL ) : '',
			)
		);
		woocommerce_wp_checkbox(
			array(
				'id'          => Lens_TryOn_Data::META_DISABLE,
				'label'       => 'Tắt thử lens',
				'description' => 'Ẩn nút thử cho sản phẩm này',
				'value'       => $p ? $p->get_meta( Lens_TryOn_Data::META_DISABLE ) : '',
			)
		);
		echo '</div></div>';
	}

	public static function save_product( $product ) {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- WooCommerce đã kiểm tra nonce khi lưu sản phẩm.
		$product->update_meta_data( Lens_TryOn_Data::META_IMAGE, isset( $_POST[ Lens_TryOn_Data::META_IMAGE ] ) ? absint( $_POST[ Lens_TryOn_Data::META_IMAGE ] ) : '' );
		foreach ( array( Lens_TryOn_Data::META_GDIA, Lens_TryOn_Data::META_OPACITY, Lens_TryOn_Data::META_PUPIL ) as $key ) {
			$val = isset( $_POST[ $key ] ) ? wc_clean( wp_unslash( $_POST[ $key ] ) ) : '';
			$product->update_meta_data( $key, '' === $val ? '' : (string) (float) $val );
		}
		$product->update_meta_data( Lens_TryOn_Data::META_DISABLE, isset( $_POST[ Lens_TryOn_Data::META_DISABLE ] ) ? 'yes' : 'no' );
		// phpcs:enable
		// Cờ _lens_tryon_has được cập nhật qua hook woocommerce_update_product / woocommerce_new_product (xem lens-tryon.php).
	}

	public static function variation_fields( $loop, $variation_data, $variation ) {
		$img  = get_post_meta( $variation->ID, Lens_TryOn_Data::META_IMAGE, true );
		$gdia = get_post_meta( $variation->ID, Lens_TryOn_Data::META_GDIA, true );
		echo '<div class="lto-var-field form-row form-row-full"><label>Ảnh lens thử (PNG trong suốt)</label><br>';
		self::image_field( 'lens_tryon_var_image[' . $loop . ']', $img, 'lens_tryon_var_image_' . $loop );
		echo '</div>';
		woocommerce_wp_text_input(
			array(
				'id'            => 'lens_tryon_var_gdia_' . $loop,
				'name'          => 'lens_tryon_var_gdia[' . $loop . ']',
				'label'         => 'GDIA riêng (mm)',
				'placeholder'   => 'Theo sản phẩm',
				'type'          => 'number',
				'value'         => $gdia,
				'wrapper_class' => 'form-row form-row-first',
				'custom_attributes' => array(
					'step' => '0.1',
					'min'  => '10',
					'max'  => '15.5',
				),
			)
		);
	}

	public static function save_variation( $variation_id, $i ) {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- WooCommerce đã kiểm tra nonce.
		$img  = isset( $_POST['lens_tryon_var_image'][ $i ] ) ? absint( $_POST['lens_tryon_var_image'][ $i ] ) : 0;
		$gdia = isset( $_POST['lens_tryon_var_gdia'][ $i ] ) ? wc_clean( wp_unslash( $_POST['lens_tryon_var_gdia'][ $i ] ) ) : '';
		// phpcs:enable
		if ( $img ) {
			update_post_meta( $variation_id, Lens_TryOn_Data::META_IMAGE, $img );
		} else {
			delete_post_meta( $variation_id, Lens_TryOn_Data::META_IMAGE );
		}
		if ( '' !== $gdia ) {
			update_post_meta( $variation_id, Lens_TryOn_Data::META_GDIA, (string) (float) $gdia );
		} else {
			delete_post_meta( $variation_id, Lens_TryOn_Data::META_GDIA );
		}
		$parent = wp_get_post_parent_id( $variation_id );
		if ( $parent ) {
			Lens_TryOn_Data::refresh_flag( $parent );
		}
	}
}
