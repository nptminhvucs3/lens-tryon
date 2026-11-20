<?php
/**
 * Plugin Name:       Lens Try-On – Thử lens trực tiếp
 * Description:       Cho khách thử kính áp tròng ngay trên khuôn mặt qua camera (AR, chạy trên trình duyệt, không cần cài app). Tích hợp WooCommerce.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            MyProject
 * License:           GPL-2.0-or-later
 * Text Domain:       lens-tryon
 * WC requires at least: 5.0
 * WC tested up to:   9.4
 */

defined( 'ABSPATH' ) || exit;

define( 'LENS_TRYON_VERSION', '1.0.0' );
define( 'LENS_TRYON_FILE', __FILE__ );
define( 'LENS_TRYON_DIR', plugin_dir_path( __FILE__ ) );
define( 'LENS_TRYON_URL', plugin_dir_url( __FILE__ ) );

require_once LENS_TRYON_DIR . 'includes/class-lens-tryon-data.php';
require_once LENS_TRYON_DIR . 'includes/class-lens-tryon-settings.php';
require_once LENS_TRYON_DIR . 'includes/class-lens-tryon-admin.php';
require_once LENS_TRYON_DIR . 'includes/class-lens-tryon-frontend.php';

// Tương thích HPOS (bảng đơn hàng mới của WooCommerce).
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', LENS_TRYON_FILE, true );
		}
	}
);

add_action(
	'plugins_loaded',
	function () {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action(
				'admin_notices',
				function () {
					echo '<div class="notice notice-warning"><p><strong>Lens Try-On:</strong> cần cài và kích hoạt WooCommerce để gắn ảnh lens cho sản phẩm.</p></div>';
				}
			);
			return;
		}
		add_action( 'woocommerce_new_product', array( 'Lens_TryOn_Data', 'refresh_flag' ) );
		add_action( 'woocommerce_update_product', array( 'Lens_TryOn_Data', 'refresh_flag' ) );
		Lens_TryOn_Settings::init();
		Lens_TryOn_Frontend::init();
		if ( is_admin() ) {
			Lens_TryOn_Admin::init();
		}
	}
);

add_filter(
	'plugin_action_links_' . plugin_basename( __FILE__ ),
	function ( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=lens-tryon' ) ) . '">' . esc_html__( 'Cài đặt', 'lens-tryon' ) . '</a>' );
		return $links;
	}
);
