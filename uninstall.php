<?php
/**
 * Gỡ plugin: xoá cài đặt. Giữ nguyên ảnh/thông số lens đã gắn vào sản phẩm.
 */
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
delete_option( 'lens_tryon_settings' );
