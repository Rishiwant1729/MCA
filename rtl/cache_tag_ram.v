// Tag storage: one TAG_W-bit tag per line. Synchronous read and write.
// The comparison against the requested tag is done by the controller
// (hit logic needs the valid bit too), so this block only stores tags.
module cache_tag_ram #(
    parameter NUM_LINES = 64,
    parameter TAG_W     = 22,
    parameter INDEX_W   = $clog2(NUM_LINES)
) (
    input  wire               clk,
    input  wire               rd_en,
    input  wire [INDEX_W-1:0] rd_index,
    output reg  [TAG_W-1:0]   rd_tag,
    input  wire               wr_en,
    input  wire [INDEX_W-1:0] wr_index,
    input  wire [TAG_W-1:0]   wr_tag
);
    reg [TAG_W-1:0] mem [0:NUM_LINES-1];

    always @(posedge clk) begin
        if (wr_en) mem[wr_index] <= wr_tag;
        if (rd_en) rd_tag <= mem[rd_index];
    end
endmodule
