// Cache data storage: NUM_LINES lines, each BLOCK_BYTES wide.
// Synchronous read (data appears the cycle after rd_en), per-byte write mask.
// Byte i of a line lives at bits [8*i +: 8] (little-endian within the block).
// The read register only changes when rd_en=1, so it holds its value otherwise.
//
// Built as one narrow RAM per byte lane (each: 1 write port, 1 read port, write
// enable = wr_en & mask bit). This is the standard way to get byte enables on
// RAM blocks; a single wide array written in a per-byte loop has many write
// ports and cannot be mapped to a RAM block by synthesis tools.
module cache_data_ram #(
    parameter NUM_LINES   = 64,
    parameter BLOCK_BYTES = 16,
    parameter INDEX_W     = $clog2(NUM_LINES)
) (
    input  wire                       clk,
    input  wire                       rd_en,
    input  wire [INDEX_W-1:0]         rd_index,
    output wire [BLOCK_BYTES*8-1:0]   rd_data,
    input  wire                       wr_en,
    input  wire [INDEX_W-1:0]         wr_index,
    input  wire [BLOCK_BYTES*8-1:0]   wr_data,
    input  wire [BLOCK_BYTES-1:0]     wr_mask    // 1 = write this byte
);
    genvar g;
    generate
        for (g = 0; g < BLOCK_BYTES; g = g + 1) begin : lane
            reg [7:0] mem [0:NUM_LINES-1];
            reg [7:0] q;
            always @(posedge clk) begin
                if (wr_en && wr_mask[g]) mem[wr_index] <= wr_data[8*g +: 8];
                if (rd_en)               q <= mem[rd_index];
            end
            assign rd_data[8*g +: 8] = q;
        end
    endgenerate
endmodule
