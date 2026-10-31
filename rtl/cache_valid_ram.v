// Valid-bit storage: one bit per line.
// Built from flip-flops (not a RAM) because every bit must clear on reset in
// one cycle; a RAM cannot be bulk-cleared. Synchronous active-low reset.
// Read is synchronous (registered) to match the data and tag RAMs.
module cache_valid_ram #(
    parameter NUM_LINES = 64,
    parameter INDEX_W   = $clog2(NUM_LINES)
) (
    input  wire               clk,
    input  wire               rst_n,
    input  wire               rd_en,
    input  wire [INDEX_W-1:0] rd_index,
    output reg                rd_valid,
    input  wire               wr_en,
    input  wire [INDEX_W-1:0] wr_index,
    input  wire               wr_valid
);
    reg [NUM_LINES-1:0] valid;

    always @(posedge clk) begin
        if (!rst_n) begin
            valid    <= {NUM_LINES{1'b0}};
            rd_valid <= 1'b0;
        end else begin
            if (wr_en) valid[wr_index] <= wr_valid;
            if (rd_en) rd_valid <= valid[rd_index];
        end
    end
endmodule
