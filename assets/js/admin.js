/* Lens Try-On – chọn ảnh lens trong trang sửa sản phẩm (cả biến thể nạp bằng AJAX). */
jQuery(function ($) {
  var frame = null, $target = null;

  $(document).on('click', '.lto-img-pick', function (e) {
    e.preventDefault();
    $target = $(this).closest('.lto-img-field');
    if (!frame) {
      frame = wp.media({
        title: 'Chọn ảnh lens (PNG nền trong suốt)',
        button: { text: 'Dùng ảnh này' },
        library: { type: 'image' },
        multiple: false
      });
      frame.on('select', function () {
        var a = frame.state().get('selection').first().toJSON();
        if (a.mime && a.mime !== 'image/png' && a.mime !== 'image/webp') {
          window.alert('Nên dùng ảnh PNG/WebP có nền trong suốt để lens hiển thị tự nhiên.');
        }
        var url = (a.sizes && a.sizes.thumbnail ? a.sizes.thumbnail.url : a.url);
        $target.find('.lto-img-input').val(a.id).trigger('change');
        $target.find('.lto-img-preview').attr('src', url);
        $target.find('.lto-img-remove').show();
        markVariationChanged($target);
      });
    }
    frame.open();
  });

  $(document).on('click', '.lto-img-remove', function (e) {
    e.preventDefault();
    var $f = $(this).closest('.lto-img-field');
    $f.find('.lto-img-input').val('').trigger('change');
    $f.find('.lto-img-preview').attr('src', '');
    $(this).hide();
    markVariationChanged($f);
  });

  // WooCommerce chỉ lưu biến thể được đánh dấu "cần cập nhật".
  function markVariationChanged($el) {
    var $v = $el.closest('.woocommerce_variation');
    if ($v.length) {
      $v.addClass('variation-needs-update');
      $('button.cancel-variation-changes, button.save-variation-changes').prop('disabled', false);
      $('#variable_product_options').trigger('woocommerce_variations_input_changed');
    }
  }
});
