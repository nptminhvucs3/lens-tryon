<?php
/**
 * Đọc dữ liệu lens từ sản phẩm WooCommerce.
 */

defined( 'ABSPATH' ) || exit;

class Lens_TryOn_Data {

	const META_IMAGE   = '_lens_tryon_image';    // ID ảnh PNG lens (nền trong suốt).
	const META_GDIA    = '_lens_tryon_gdia';     // Đường kính đồ hoạ (mm).
	const META_OPACITY = '_lens_tryon_opacity';  // Độ phủ màu 0.2–1.
	const META_PUPIL   = '_lens_tryon_pupil';    // Bán kính vùng đồng tử giữ lại (0–0.6, theo bán kính mống mắt).
	const META_DISABLE = '_lens_tryon_disabled'; // 'yes' = tắt thử lens cho sản phẩm.
	const META_HAS     = '_lens_tryon_has';      // Cờ nội bộ: sản phẩm có ít nhất 1 ảnh thử.

	/**
	 * Cập nhật cờ "có ảnh thử" cho sản phẩm cha (dùng để truy vấn sản phẩm liên quan).
	 *
	 * @param int $product_id ID sản phẩm cha.
	 */
	public static function refresh_flag( $product_id ) {
		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			return;
		}
		$has = (bool) $product->get_meta( self::META_IMAGE );
		if ( ! $has && $product->is_type( 'variable' ) ) {
			foreach ( $product->get_children() as $child_id ) {
				if ( get_post_meta( $child_id, self::META_IMAGE, true ) ) {
					$has = true;
					break;
				}
			}
		}
		if ( $has && 'yes' !== $product->get_meta( self::META_DISABLE ) ) {
			update_post_meta( $product_id, self::META_HAS, 'yes' );
		} else {
			delete_post_meta( $product_id, self::META_HAS );
		}
	}

	/**
	 * Danh sách lens (mỗi màu/biến thể = 1 mục) của một sản phẩm.
	 *
	 * @param WC_Product $product Sản phẩm.
	 * @param bool       $current Là sản phẩm đang xem.
	 * @return array
	 */
	public static function product_lenses( $product, $current = false ) {
		if ( ! $product || 'yes' === $product->get_meta( self::META_DISABLE ) ) {
			return array();
		}
		$parent_img     = absint( $product->get_meta( self::META_IMAGE ) );
		$parent_gdia    = $product->get_meta( self::META_GDIA );
		$parent_opacity = $product->get_meta( self::META_OPACITY );
		$parent_pupil   = $product->get_meta( self::META_PUPIL );
		$items          = array();

		if ( $product->is_type( 'variable' ) ) {
			foreach ( $product->get_children() as $child_id ) {
				$variation = wc_get_product( $child_id );
				if ( ! $variation || ! $variation->exists() || 'publish' !== $variation->get_status() ) {
					continue;
				}
				if ( ! $variation->variation_is_visible() ) {
					continue;
				}
				$img = absint( $variation->get_meta( self::META_IMAGE ) );
				if ( ! $img ) {
					$img = $parent_img;
				}
				if ( ! $img ) {
					continue;
				}
				$attrs         = $variation->get_variation_attributes();
				$needs_options = in_array( '', array_map( 'strval', $attrs ), true );
				$label         = wc_get_formatted_variation( $variation, true, false, false );
				$gdia          = $variation->get_meta( self::META_GDIA );

				$items[] = self::item(
					array(
						'id'           => (string) $child_id,
						'productId'    => $product->get_id(),
						'variationId'  => $child_id,
						'name'         => $label ? $label : $product->get_name(),
						'group'        => $product->get_name(),
						'label'        => $product->get_name() . ( $label ? ' – ' . $label : '' ),
						'image_id'     => $img,
						'thumb_id'     => $variation->get_image_id() && $variation->get_image_id() !== $product->get_image_id() ? $variation->get_image_id() : $img,
						'priceHtml'    => $variation->get_price_html(),
						'url'          => $variation->get_permalink(),
						'gdia'         => '' !== $gdia ? $gdia : $parent_gdia,
						'opacity'      => $parent_opacity,
						'pupil'        => $parent_pupil,
						'inStock'      => $variation->is_in_stock() && $variation->is_purchasable(),
						'needsOptions' => $needs_options,
						'attributes'   => $attrs,
						'current'      => $current,
					)
				);
			}
		} elseif ( $parent_img ) {
			$items[] = self::item(
				array(
					'id'           => (string) $product->get_id(),
					'productId'    => $product->get_id(),
					'variationId'  => 0,
					'name'         => $product->get_name(),
					'group'        => $product->get_name(),
					'label'        => $product->get_name(),
					'image_id'     => $parent_img,
					'thumb_id'     => $product->get_image_id() ? $product->get_image_id() : $parent_img,
					'priceHtml'    => $product->get_price_html(),
					'url'          => $product->get_permalink(),
					'gdia'         => $parent_gdia,
					'opacity'      => $parent_opacity,
					'pupil'        => $parent_pupil,
					'inStock'      => $product->is_in_stock() && $product->is_purchasable(),
					'needsOptions' => ! $product->is_type( 'simple' ),
					'attributes'   => null,
					'current'      => $current,
				)
			);
		}

		return apply_filters( 'lens_tryon_product_lenses', $items, $product );
	}

	/**
	 * Chuẩn hoá 1 mục lens.
	 *
	 * @param array $d Dữ liệu thô.
	 * @return array
	 */
	private static function item( $d ) {
		$d['image'] = wp_get_attachment_image_url( $d['image_id'], 'full' );
		$thumb      = wp_get_attachment_image_url( $d['thumb_id'], 'thumbnail' );
		$d['thumb'] = $thumb ? $thumb : $d['image'];
		$d['gdia']  = '' !== (string) $d['gdia'] ? (float) $d['gdia'] : 0;
		$d['opacity'] = '' !== (string) $d['opacity'] ? (float) $d['opacity'] : null;
		$d['pupil']   = '' !== (string) $d['pupil'] ? (float) $d['pupil'] : null;
		$d['name']    = wp_strip_all_tags( $d['name'] );
		$d['label']   = wp_strip_all_tags( $d['label'] );
		$d['group']   = wp_strip_all_tags( $d['group'] );
		unset( $d['image_id'], $d['thumb_id'] );
		return $d;
	}

	/**
	 * Lens của sản phẩm hiện tại + các sản phẩm lens khác (để đổi mẫu ngay trong giao diện thử).
	 *
	 * @param WC_Product $product Sản phẩm đang xem.
	 * @return array
	 */
	public static function lenses_for_page( $product ) {
		$lenses = $product ? self::product_lenses( $product, true ) : array();
		$scope  = Lens_TryOn_Settings::get( 'related_scope' );
		$limit  = (int) Lens_TryOn_Settings::get( 'related_count' );

		if ( 'none' !== $scope && $limit > 0 ) {
			$args = array(
				'post_type'      => 'product',
				'post_status'    => 'publish',
				'posts_per_page' => $limit,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'orderby'        => 'menu_order date',
				'order'          => 'DESC',
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery
					array(
						'key'   => self::META_HAS,
						'value' => 'yes',
					),
				),
			);
			if ( $product ) {
				$args['post__not_in'] = array( $product->get_id() );
				if ( 'category' === $scope ) {
					$cats = wc_get_product_term_ids( $product->get_id(), 'product_cat' );
					if ( $cats ) {
						$args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery
							array(
								'taxonomy' => 'product_cat',
								'field'    => 'term_id',
								'terms'    => $cats,
							),
						);
					}
				}
			}
			$ids = get_posts( apply_filters( 'lens_tryon_related_query', $args, $product ) );
			foreach ( $ids as $id ) {
				$other = wc_get_product( $id );
				if ( $other && $other->is_visible() ) {
					$lenses = array_merge( $lenses, self::product_lenses( $other, false ) );
				}
				if ( count( $lenses ) > 60 ) {
					break;
				}
			}
		}
		return apply_filters( 'lens_tryon_lenses', $lenses, $product );
	}
}
