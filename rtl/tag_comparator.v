// Tag comparator: does the tag stored in the selected line equal the tag of the request?
// Pure combinational logic. It does not look at the valid bit; hit_miss_unit combines the two.
module tag_comparator #(
    parameter TAG_W = 22
) (
    input  wire [TAG_W-1:0] stored_tag,    // tag read from the tag RAM at [index]
    input  wire [TAG_W-1:0] request_tag,   // tag field of the request address
    output wire             match
);
    assign match = (stored_tag == request_tag);
endmodule
