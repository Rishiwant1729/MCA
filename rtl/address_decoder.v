// Splits a byte address into tag / index / offset.
// All widths are derived from the parameters; nothing is hardcoded.
// Initial config (32-bit addr, 1KB cache, 16B block): tag=[31:10] index=[9:4] offset=[3:0]
module address_decoder #(
    parameter ADDR_WIDTH  = 32,
    parameter CACHE_BYTES = 1024,
    parameter BLOCK_BYTES = 16,
    // derived (do not override)
    parameter NUM_LINES   = CACHE_BYTES / BLOCK_BYTES,
    parameter OFFSET_W    = $clog2(BLOCK_BYTES),
    parameter INDEX_W     = $clog2(NUM_LINES),
    parameter TAG_W       = ADDR_WIDTH - INDEX_W - OFFSET_W
) (
    input  wire [ADDR_WIDTH-1:0] addr,
    output wire [TAG_W-1:0]      tag,
    output wire [INDEX_W-1:0]    index,
    output wire [OFFSET_W-1:0]   offset,
    output wire [ADDR_WIDTH-1:0] block_addr   // addr with offset bits cleared
);
    // Geometry checks: sizes must be powers of two and the tag must be non-empty.
    generate
        if ((BLOCK_BYTES & (BLOCK_BYTES - 1)) != 0)
            bad_parameter_BLOCK_BYTES_must_be_power_of_two u_err();
        if ((NUM_LINES & (NUM_LINES - 1)) != 0 || CACHE_BYTES % BLOCK_BYTES != 0)
            bad_parameter_NUM_LINES_must_be_power_of_two u_err2();
        if (TAG_W < 1)
            bad_parameter_tag_width_must_be_positive u_err3();
    endgenerate

    assign offset     = addr[OFFSET_W-1:0];
    assign index      = addr[OFFSET_W +: INDEX_W];
    assign tag        = addr[OFFSET_W + INDEX_W +: TAG_W];
    assign block_addr = {addr[ADDR_WIDTH-1:OFFSET_W], {OFFSET_W{1'b0}}};
endmodule
