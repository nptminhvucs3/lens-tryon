<?php
/**
 * Trang sản phẩm: nút "Thử lens", nạp script, endpoint thêm vào giỏ.
 */

defined( 'ABSPATH' ) || exit;

class Lens_TryOn_Frontend {

	/** @var bool */
	private static $enqueued = false;

	/** @var array Lens đã đưa vào trang (theo id). */
	private static $lenses = array();

	public static function init() {
		add_action( 'wp', array( __CLASS__, 'setup_product_page' ) );
		add_shortcode( 'lens_tryon_button', array( __CLASS__, 'shortcode' ) );
		add_action( 'wc_ajax_lens_tryon_add_to_cart', array( __CLASS__, 'ajax_add_to_cart' ) );
		add_action( 'wp_footer', array( __CLASS__, 'print_config' ), 5 );
	}

	/**
	 * Gắn nút vào trang sản phẩm theo vị trí trong cài đặt.
	 */
	public static function setup_product_page() {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return;
		}
		$position = Lens_TryOn_Settings::get( 'button_position' );
		$hooks    = array(
			'after_add_to_cart'  => array( 'woocommerce_after_add_to_cart_form', 10 ),
			'before_add_to_cart' => array( 'woocommerce_before_add_to_cart_form', 10 ),
			'after_summary'      => array( 'woocommerce_single_product_summary', 35 ),
		);
		if ( isset( $hooks[ $position ] ) ) {
			add_action( $hooks[ $position ][0], array( __CLASS__, 'render_auto_button' ), $hooks[ $position ][1] );
		}
	}

	public static function render_auto_button() {
		global $product;
		static $done = false;
		if ( $done || ! $product instanceof WC_Product ) {
			return;
		}
		$done = true;
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- đã escape trong button_html().
		echo self::button_html( $product );
	}

	/**
	 * Shortcode [lens_tryon_button product_id="123" text="Thử ngay" lens="456"].
	 */
	public static function shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'product_id' => 0,
				'text'       => '',
				'lens'       => '',
				'class'      => '',
			),
			$atts,
			'lens_tryon_button'
		);
		$product = $atts['product_id'] ? wc_get_product( absint( $atts['product_id'] ) ) : null;
		if ( ! $product ) {
			global $product;
		}
		if ( ! $product instanceof WC_Product ) {
			$product = wc_get_product( get_the_ID() );
		}
		if ( ! $product ) {
			return '';
		}
		return self::button_html( $product, $atts['text'], $atts['lens'], $atts['class'] );
	}

	/**
	 * HTML nút + đăng ký dữ liệu lens.
	 */
	public static function button_html( $product, $text = '', $lens_id = '', $class = '' ) {
		$lenses = Lens_TryOn_Data::lenses_for_page( $product );
		$own    = array_filter(
			$lenses,
			function ( $l ) {
				return ! empty( $l['current'] );
			}
		);
		if ( ! $own ) {
			return '';
		}
		foreach ( $lenses as $l ) {
			if ( ! isset( self::$lenses[ $l['id'] ] ) || ! empty( $l['current'] ) ) {
				self::$lenses[ $l['id'] ] = $l;
			}
		}
		self::enqueue();

		$text = $text ? $text : Lens_TryOn_Settings::get( 'button_text' );
		$icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
		return sprintf(
			'<button type="button" class="lens-tryon-button %1$s" data-lens-tryon%2$s>%3$s<span>%4$s</span></button>',
			esc_attr( $class ),
			$lens_id ? ' data-lens-id="' . esc_attr( $lens_id ) . '"' : '',
			$icon,
			esc_html( $text )
		);
	}

	public static function enqueue() {
		if ( self::$enqueued ) {
			return;
		}
		self::$enqueued = true;
		$css = LENS_TRYON_DIR . 'assets/css/lens-tryon.css';
		$js  = LENS_TRYON_DIR . 'assets/js/lens-tryon.js';
		wp_enqueue_style( 'lens-tryon', LENS_TRYON_URL . 'assets/css/lens-tryon.css', array(), LENS_TRYON_VERSION . '.' . filemtime( $css ) );
		wp_add_inline_style( 'lens-tryon', ':root{--lens-tryon-accent:' . esc_attr( Lens_TryOn_Settings::get( 'accent' ) ) . '}' );
		wp_enqueue_script( 'lens-tryon', LENS_TRYON_URL . 'assets/js/lens-tryon.js', array(), LENS_TRYON_VERSION . '.' . filemtime( $js ), true );
	}

	/**
	 * In cấu hình trước khi script chạy (footer, trước wp_print_footer_scripts).
	 */
	public static function print_config() {
		if ( ! self::$enqueued ) {
			return;
		}
		$s   = Lens_TryOn_Settings::get();
		$cfg = array(
			'lenses'       => array_values( self::$lenses ),
			'addToCartUrl' => class_exists( 'WC_AJAX' ) ? WC_AJAX::get_endpoint( 'lens_tryon_add_to_cart' ) : '',
			'cartUrl'      => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '',
			'accent'       => $s['accent'],
			'watermark'    => $s['watermark'],
			'privacyNote'  => $s['privacy_note'],
			'tuning'       => array(
				'irisMM'   => (float) $s['iris_mm'],
				'maxScale' => (float) $s['max_scale'],
			),
		);
		foreach ( array( 'vision_url' => 'visionUrl', 'wasm_url' => 'wasmUrl', 'model_url' => 'modelUrl' ) as $k => $js_key ) {
			if ( ! empty( $s[ $k ] ) ) {
				$cfg[ $js_key ] = $s[ $k ];
			}
		}
		$cfg = apply_filters( 'lens_tryon_config', $cfg );
		wp_add_inline_script( 'lens-tryon', 'window.LensTryOnConfig = Object.assign(window.LensTryOnConfig || {}, ' . wp_json_encode( $cfg ) . ');', 'before' );
	}

	/**
	 * Thêm vào giỏ từ giao diện thử (endpoint ?wc-ajax=lens_tryon_add_to_cart).
	 * Giống WC_AJAX::add_to_cart nhưng hỗ trợ biến thể.
	 */
	public static function ajax_add_to_cart() {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- giống add_to_cart gốc của WooCommerce (tương thích cache trang).
		$product_id   = isset( $_POST['product_id'] ) ? absint( $_POST['product_id'] ) : 0;
		$variation_id = isset( $_POST['variation_id'] ) ? absint( $_POST['variation_id'] ) : 0;
		$quantity     = isset( $_POST['quantity'] ) ? wc_stock_amount( wp_unslash( $_POST['quantity'] ) ) : 1;
		// phpcs:enable
		$quantity = max( 1, $quantity );

		$product = wc_get_product( $product_id );
		if ( ! $product || 'publish' !== get_post_status( $product_id ) ) {
			wp_send_json( array( 'error' => true, 'message' => 'Sản phẩm không tồn tại.' ) );
		}

		$attributes = array();
		if ( $variation_id ) {
			$variation = wc_get_product( $variation_id );
			if ( ! $variation || (int) $variation->get_parent_id() !== $product_id ) {
				wp_send_json( array( 'error' => true, 'message' => 'Biến thể không hợp lệ.', 'product_url' => $product->get_permalink() ) );
			}
			$attributes = $variation->get_variation_attributes();
			if ( in_array( '', array_map( 'strval', $attributes ), true ) ) {
				wp_send_json( array( 'error' => true, 'message' => 'Vui lòng chọn đầy đủ tuỳ chọn trên trang sản phẩm.', 'product_url' => $product->get_permalink() ) );
			}
		} elseif ( ! $product->is_type( 'simple' ) ) {
			wp_send_json( array( 'error' => true, 'message' => 'Vui lòng chọn tuỳ chọn trên trang sản phẩm.', 'product_url' => $product->get_permalink() ) );
		}

		if ( is_null( WC()->cart ) && function_exists( 'wc_load_cart' ) ) {
			wc_load_cart();
		}

		$passed = apply_filters( 'woocommerce_add_to_cart_validation', true, $product_id, $quantity, $variation_id, $attributes );
		if ( $passed && false !== WC()->cart->add_to_cart( $product_id, $quantity, $variation_id, $attributes ) ) {
			do_action( 'woocommerce_ajax_added_to_cart', $product_id );
			wc_clear_notices();
			WC_AJAX::get_refreshed_fragments(); // Trả JSON {fragments, cart_hash} rồi dừng.
		}

		$messages = array();
		foreach ( wc_get_notices( 'error' ) as $notice ) {
			$messages[] = wp_strip_all_tags( is_array( $notice ) ? $notice['notice'] : $notice );
		}
		wc_clear_notices();
		wp_send_json(
			array(
				'error'       => true,
				'message'     => $messages ? implode( ' ', $messages ) : 'Không thể thêm sản phẩm vào giỏ.',
				'product_url' => $product->get_permalink(),
			)
		);
	}
}
